import { Type } from '@google/genai';
import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { AuthService } from 'src/auth/auth.service';
import { FLASHCARD_SYSTEM_INSTRUCTION } from './prompts/flashcard-system-prompt';
import { GeminiClientService } from './gemini-client.service';

const AI_TIMEOUT_MS = 90_000;
const retryDelayMs = () => new Promise((r) => setTimeout(r, 1000));

@Injectable()
export class AiStructuredGenerationService {
  constructor(
    private readonly geminiClient: GeminiClientService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  private async generateWithRetry<T extends { text?: string }>(
    run: () => Promise<T>,
    maxAttempts = 2,
  ): Promise<T> {
    let attempts = 0;
    while (attempts < maxAttempts) {
      try {
        return await Promise.race([
          run(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('Request timeout - AI service took too long to respond')),
              AI_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (e) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(
            `Failed after ${maxAttempts} attempts. ${e instanceof Error ? e.message : 'AI service unavailable'}`,
          );
        }
        await retryDelayMs();
      }
    }
    throw new Error('Unreachable');
  }

  async generateFlashcardDeckContent(
    userId: string,
    topic: string,
    cardCount: number,
  ): Promise<{ title: string; cards: { front: string; back: string }[] }> {
    const topicTrimmed = topic.trim();
    const u = await this.authService.getUserById(userId);
    if (!u) throw new NotFoundException('User not found');
    const model = u.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const userPayload = `Topic / instructions:\n${topicTrimmed}\n\nGenerate exactly ${cardCount} flashcards. Return a deck title and ${cardCount} cards.`;
    const result = await this.generateWithRetry(() =>
      this.geminiClient.genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: userPayload }] }],
        config: {
          temperature: 0.2,
          maxOutputTokens: Math.min(8192, 400 + cardCount * 220),
          systemInstruction: FLASHCARD_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Short title for this deck' },
              cards: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    front: { type: Type.STRING, description: 'Question or term on the front' },
                    back: { type: Type.STRING, description: 'Answer or explanation on the back' },
                  },
                  required: ['front', 'back'],
                },
              },
            },
            required: ['title', 'cards'],
          },
        },
      }),
    );
    const response = result?.text ?? '';
    if (!response.trim()) throw new Error('AI returned empty response. Please try again.');
    let parsed: { title: string; cards: { front: string; back: string }[] };
    try {
      parsed = JSON.parse(response) as typeof parsed;
    } catch {
      throw new Error('Failed to parse flashcards from AI response.');
    }
    if (!parsed.title?.trim() || !Array.isArray(parsed.cards) || parsed.cards.length !== cardCount) {
      throw new Error(`Expected exactly ${cardCount} cards and a non-empty title. Please try again.`);
    }
    for (let i = 0; i < parsed.cards.length; i++) {
      const c = parsed.cards[i];
      if (!c.front?.trim() || !c.back?.trim() || typeof c.front !== 'string' || typeof c.back !== 'string') {
        throw new Error(`Card ${i + 1} is invalid. Please try again.`);
      }
    }
    return parsed;
  }

  async generatePublicQuizDeckContent(
    userId: string,
    topic: string,
    questionCount: number,
  ): Promise<{
    title: string;
    description?: string;
    questions: {
      question: string;
      options: string[];
      correctAnswer: string;
      explanation: string;
    }[];
  }> {
    const topicTrimmed = topic.trim();
    const u = await this.authService.getUserById(userId);
    if (!u) throw new NotFoundException('User not found');
    const model = u.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const userPayload = `Topic / instructions:\n${topicTrimmed}\n\nGenerate exactly ${questionCount} multiple-choice questions. Each question must have exactly 4 options; correctAnswer must equal one option exactly. Include a short quiz title and optional one-line description.`;
    const result = await this.generateWithRetry(() =>
      this.geminiClient.genAI.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: userPayload }] }],
        config: {
          temperature: 0.2,
          maxOutputTokens: Math.min(8192, 400 + questionCount * 280),
          systemInstruction:
            'You create accurate educational multiple-choice quizzes for Web3 and technical topics. Output must follow the JSON schema exactly.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: 'Short title for the quiz listing' },
              description: { type: Type.STRING, description: 'Optional subtitle or scope (one line)' },
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctAnswer: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                  },
                  required: ['question', 'options', 'correctAnswer', 'explanation'],
                },
              },
            },
            required: ['title', 'questions'],
          },
        },
      }),
    );
    const response = result?.text ?? '';
    if (!response.trim()) throw new Error('AI returned empty response. Please try again.');
    let parsed: {
      title: string;
      description?: string;
      questions: {
        question: string;
        options: string[];
        correctAnswer: string;
        explanation: string;
      }[];
    };
    try {
      parsed = JSON.parse(response) as typeof parsed;
    } catch {
      throw new Error('Failed to parse quiz from AI response.');
    }
    if (!parsed.title?.trim() || !Array.isArray(parsed.questions) || parsed.questions.length !== questionCount) {
      throw new Error(`Expected exactly ${questionCount} questions and a non-empty title. Please try again.`);
    }
    for (let i = 0; i < parsed.questions.length; i++) {
      const q = parsed.questions[i];
      if (
        !q.question?.trim() ||
        !Array.isArray(q.options) ||
        q.options.length !== 4 ||
        !q.correctAnswer ||
        !q.explanation?.trim() ||
        !q.options.includes(q.correctAnswer)
      ) {
        throw new Error(`Question ${i + 1} is invalid. Please try again.`);
      }
    }
    return {
      title: parsed.title.trim(),
      description: parsed.description?.trim(),
      questions: parsed.questions,
    };
  }
}
