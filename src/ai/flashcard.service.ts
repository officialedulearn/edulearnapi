import { Type } from '@google/genai';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  flashcardDeck,
  flashcard,
  type FlashcardDeck,
  type Flashcard,
} from 'lib/db/schema';
import db from '../../drizzle';
import { eq, and, desc, asc } from 'drizzle-orm';
import { AuthService } from 'src/auth/auth.service';
import { FLASHCARD_SYSTEM_INSTRUCTION } from './prompts/flashcard-system-prompt';
import { GeminiClientService } from './gemini-client.service';

@Injectable()
export class FlashcardService {
  constructor(
    private readonly geminiClient: GeminiClientService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  private async checkUserCredits(userId: string): Promise<number> {
    try {
      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new NotFoundException(`User with id ${userId} not found`);
      }

      return Number(user.credits || 0);
    } catch (error) {
      console.error('Failed to check user credits', error);
      throw error;
    }
  }

  async generateFlashcards(dto: {
    userId: string;
    topic: string;
    cardCount?: number;
  }): Promise<{
    deck: {
      id: string;
      userId: string;
      title: string;
      topic: string;
      createdAt: Date;
      updatedAt: Date | null;
    };
    cards: {
      id: string;
      deckId: string;
      front: string;
      back: string;
      sortOrder: number;
    }[];
  }> {
    const cardCount = dto.cardCount ?? 15;
    const topic = dto.topic.trim();
    const userId = dto.userId;
    const cost = 0.5 * cardCount;

    const userCredits = await this.checkUserCredits(userId);
    if (userCredits < cost) {
      throw new ForbiddenException(
        `Insufficient credits. You need at least ${cost} credits (${0.5} per card × ${cardCount} cards).`,
      );
    }

    const u = await this.authService.getUserById(userId);
    if (!u) {
      throw new NotFoundException('User not found');
    }

    const model = u.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const userPayload = `Topic / instructions:\n${topic}\n\nGenerate exactly ${cardCount} flashcards. Return a deck title and ${cardCount} cards.`;

    let result: { text?: string } | undefined;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        result = await Promise.race([
          this.geminiClient.genAI.models.generateContent({
            model,
            contents: userPayload,
            config: {
              temperature: 0.2,
              maxOutputTokens: Math.min(8192, 400 + cardCount * 220),
              systemInstruction: FLASHCARD_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: {
                    type: Type.STRING,
                    description: 'Short title for this deck',
                  },
                  cards: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        front: {
                          type: Type.STRING,
                          description: 'Question or term on the front',
                        },
                        back: {
                          type: Type.STRING,
                          description: 'Answer or explanation on the back',
                        },
                      },
                      required: ['front', 'back'],
                    },
                  },
                },
                required: ['title', 'cards'],
              },
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Request timeout - AI service took too long to respond',
                  ),
                ),
              90000,
            ),
          ),
        ]);
        break;
      } catch (attemptError) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(
            `Failed to generate flashcards after ${maxAttempts} attempts. ${
              attemptError instanceof Error
                ? attemptError.message
                : 'AI service unavailable'
            }`,
          );
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const response = result?.text ?? '';
    if (!response.trim()) {
      throw new Error('AI returned empty response. Please try again.');
    }

    let parsed: { title: string; cards: { front: string; back: string }[] };
    try {
      parsed = JSON.parse(response) as {
        title: string;
        cards: { front: string; back: string }[];
      };
    } catch {
      throw new Error('Failed to parse flashcards from AI response.');
    }

    if (
      !parsed.title?.trim() ||
      !Array.isArray(parsed.cards) ||
      parsed.cards.length !== cardCount
    ) {
      throw new Error(
        `Expected exactly ${cardCount} cards and a non-empty title. Please try again.`,
      );
    }

    for (let i = 0; i < parsed.cards.length; i++) {
      const c = parsed.cards[i];
      if (
        !c.front?.trim() ||
        !c.back?.trim() ||
        typeof c.front !== 'string' ||
        typeof c.back !== 'string'
      ) {
        throw new Error(`Card ${i + 1} is invalid. Please try again.`);
      }
    }

    const [deckRow] = await db
      .insert(flashcardDeck)
      .values({
        userId,
        title: parsed.title.trim(),
        topic,
      })
      .returning();

    if (!deckRow) {
      throw new Error('Failed to save flashcard deck.');
    }

    try {
      await db.insert(flashcard).values(
        parsed.cards.map((c, i) => ({
          deckId: deckRow.id,
          front: c.front.trim(),
          back: c.back.trim(),
          sortOrder: i,
        })),
      );
    } catch (insertErr) {
      await db.delete(flashcardDeck).where(eq(flashcardDeck.id, deckRow.id));
      throw insertErr;
    }

    try {
      await this.authService.deductUserCredits(userId, cost);
    } catch (deductErr) {
      await db.delete(flashcardDeck).where(eq(flashcardDeck.id, deckRow.id));
      if (
        deductErr instanceof Error &&
        deductErr.message.includes('Insufficient credits')
      ) {
        throw new ForbiddenException(deductErr.message);
      }
      throw deductErr;
    }

    const cardRows = await db
      .select()
      .from(flashcard)
      .where(eq(flashcard.deckId, deckRow.id))
      .orderBy(asc(flashcard.sortOrder));

    return { deck: deckRow, cards: cardRows };
  }

  async listFlashcardDecks(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ decks: FlashcardDeck[] }> {
    const lim = Math.min(Math.max(1, limit), 100);
    const off = Math.max(0, offset);
    const decks = await db
      .select()
      .from(flashcardDeck)
      .where(eq(flashcardDeck.userId, userId))
      .orderBy(desc(flashcardDeck.createdAt))
      .limit(lim)
      .offset(off);
    return { decks };
  }

  async getFlashcardDeckWithCards(
    userId: string,
    deckId: string,
  ): Promise<{
    deck: FlashcardDeck;
    cards: Flashcard[];
  }> {
    const [deck] = await db
      .select()
      .from(flashcardDeck)
      .where(eq(flashcardDeck.id, deckId));
    if (!deck || deck.userId !== userId) {
      throw new NotFoundException('Deck not found');
    }
    const cards = await db
      .select()
      .from(flashcard)
      .where(eq(flashcard.deckId, deckId))
      .orderBy(asc(flashcard.sortOrder));
    return { deck, cards };
  }

  async deleteFlashcardDeck(userId: string, deckId: string): Promise<void> {
    const res = await db
      .delete(flashcardDeck)
      .where(
        and(eq(flashcardDeck.id, deckId), eq(flashcardDeck.userId, userId)),
      )
      .returning();
    if (!res.length) {
      throw new NotFoundException('Deck not found');
    }
  }
}
