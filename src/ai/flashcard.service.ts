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
import { RedisService } from 'src/redis/redis.service';

const FLASHCARD_DECK_LIST_TTL_SEC = 5 * 60;

type FlashcardDeckListResponse = {
  decks: FlashcardDeck[];
};

const parseFlashcardDeckListCache = (
  raw: string,
): FlashcardDeckListResponse | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const decks = (parsed as { decks?: unknown }).decks;
    if (!Array.isArray(decks)) return null;
    return { decks: decks as FlashcardDeck[] };
  } catch {
    return null;
  }
};

@Injectable()
export class FlashcardService {
  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly redisService: RedisService,
  ) {}

  private buildFlashcardDeckListCacheKey(
    userId: string,
    limit: number,
    offset: number,
    version: number,
  ) {
    return `flashcard_decks:${userId}:v${version}:l${limit}:o${offset}`;
  }

  private async bumpFlashcardDeckListVersion(userId: string): Promise<void> {
    try {
      await this.redisService.bumpFlashcardDeckListVersion(userId);
    } catch (error) {
      console.error('Flashcard deck cache version bump failed:', error);
    }
  }

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

  async saveFlashcardDeck(dto: {
    userId: string;
    topic: string;
    title: string;
    cards: { front: string; back: string }[];
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
    const topic = dto.topic.trim();
    const title = dto.title.trim();
    const cards = dto.cards;
    const userId = dto.userId;
    const cardCount = cards.length;
    const cost = 0.5 * cardCount;

    const userCredits = await this.checkUserCredits(userId);
    if (userCredits < cost) {
      throw new ForbiddenException(
        `Insufficient credits. You need at least ${cost} credits (${0.5} per card × ${cardCount} cards).`,
      );
    }

    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (
        !c.front?.trim() ||
        !c.back?.trim() ||
        typeof c.front !== 'string' ||
        typeof c.back !== 'string'
      ) {
        throw new Error(`Card ${i + 1} is invalid.`);
      }
    }

    const [deckRow] = await db
      .insert(flashcardDeck)
      .values({
        userId,
        title,
        topic,
      })
      .returning();

    if (!deckRow) {
      throw new Error('Failed to save flashcard deck.');
    }

    try {
      await db.insert(flashcard).values(
        cards.map((c, i) => ({
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
    await this.bumpFlashcardDeckListVersion(userId);

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
  ): Promise<FlashcardDeckListResponse> {
    const lim = Math.min(Math.max(1, limit), 100);
    const off = Math.max(0, offset);

    let cacheKey: string | null = null;
    try {
      const version =
        await this.redisService.getFlashcardDeckListVersion(userId);
      cacheKey = this.buildFlashcardDeckListCacheKey(userId, lim, off, version);
      const raw = await this.redisService.getFlashcardDeckListPayload(cacheKey);
      if (raw) {
        const cached = parseFlashcardDeckListCache(raw);
        if (cached) return cached;
      }
    } catch (error) {
      console.error('Flashcard deck cache read failed:', error);
    }

    const decks = await db
      .select()
      .from(flashcardDeck)
      .where(eq(flashcardDeck.userId, userId))
      .orderBy(desc(flashcardDeck.createdAt))
      .limit(lim)
      .offset(off);

    if (cacheKey) {
      try {
        await this.redisService.setFlashcardDeckListPayload(
          cacheKey,
          FLASHCARD_DECK_LIST_TTL_SEC,
          JSON.stringify({ decks }),
        );
      } catch (error) {
        console.error('Flashcard deck cache write failed:', error);
      }
    }

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
    await this.bumpFlashcardDeckListVersion(userId);
  }
}
