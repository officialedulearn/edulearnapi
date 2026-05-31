import { Type } from '@google/genai';
import {
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { AuthService } from 'src/auth/auth.service';
import { FLASHCARD_SYSTEM_INSTRUCTION } from './prompts/flashcard-system-prompt';
import { GeminiClientService } from './gemini-client.service';
import {
  buildQuizMetadataFromQuestions,
  formatQuizHistoryForPrompt,
  validateQuizDiversity,
} from './quiz-diversity.util';
import { getRecentQuizGenerationHistory } from 'src/quizzes/quiz-generation-history';

const AI_TIMEOUT_MS = 90_000;
const retryDelayMs = () => new Promise((r) => setTimeout(r, 1000));

type GeneratedPublicQuizDeck = {
  title: string;
  description?: string;
  summary?: string;
  coveredConcepts?: string[];
  challengeProfile?: string;
  questions: {
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
  }[];
};

type RawGeneratedPublicQuizQuestion = {
  question?: unknown;
  prompt?: unknown;
  stem?: unknown;
  text?: unknown;
  options?: unknown;
  choices?: unknown;
  answerOptions?: unknown;
  correctAnswer?: unknown;
  correct_answer?: unknown;
  answer?: unknown;
  correct?: unknown;
  explanation?: unknown;
  rationale?: unknown;
  reason?: unknown;
};

type RawGeneratedPublicQuizDeck = {
  title?: unknown;
  quizTitle?: unknown;
  name?: unknown;
  description?: unknown;
  summary?: unknown;
  coveredConcepts?: unknown;
  challengeProfile?: unknown;
  questions?: unknown;
  quizQuestions?: unknown;
  items?: unknown;
  quiz?: unknown;
  deck?: unknown;
  publicQuiz?: unknown;
  data?: unknown;
  result?: unknown;
};

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
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          run(),
          new Promise<never>((_, reject) =>
            (timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    'Request timeout - AI service took too long to respond',
                  ),
                ),
              AI_TIMEOUT_MS,
            )),
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
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw new Error('Unreachable');
  }

  private cleanAiJsonText(response: string): string {
    let cleaned = response.trim().replace(/^\uFEFF/, '');
    const jsonFence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonFence?.[1]) {
      cleaned = jsonFence[1].trim();
    }
    return cleaned
      .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .trim();
  }

  private extractJsonValue(
    response: string,
    expectedRoot: 'object' | 'array',
  ): string {
    const cleaned = this.cleanAiJsonText(response);
    const rootChar = expectedRoot === 'object' ? '{' : '[';
    const start = cleaned.indexOf(rootChar);
    if (start === -1) return cleaned;

    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = start; i < cleaned.length; i++) {
      const char = cleaned[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') {
        stack.push('}');
      } else if (char === '[') {
        stack.push(']');
      } else if (char === '}' || char === ']') {
        if (stack.length === 0 || stack[stack.length - 1] !== char) break;
        stack.pop();
        if (stack.length === 0) {
          return cleaned.slice(start, i + 1);
        }
      }
    }

    return cleaned.slice(start);
  }

  private repairJsonValue(jsonValue: string): string {
    let repaired = jsonValue.trim().replace(/,(\s*[}\]])/g, '$1');
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') {
        stack.push('}');
      } else if (char === '[') {
        stack.push(']');
      } else if (char === '}' || char === ']') {
        if (stack[stack.length - 1] === char) {
          stack.pop();
        }
      }
    }

    if (inString) repaired += '"';
    while (stack.length > 0) {
      repaired += stack.pop();
    }
    return repaired;
  }

  private parseGeneratedJsonObject(response: string): RawGeneratedPublicQuizDeck {
    const candidates = [
      response.trim(),
      this.cleanAiJsonText(response),
      this.extractJsonValue(response, 'object'),
      this.extractJsonValue(response, 'array'),
    ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const repaired = this.repairJsonValue(candidate);
      for (const jsonValue of [candidate, repaired]) {
        try {
          const parsed = JSON.parse(jsonValue) as unknown;
          if (Array.isArray(parsed)) {
            return { questions: parsed };
          }
          if (parsed && typeof parsed === 'object') {
            return parsed as RawGeneratedPublicQuizDeck;
          }
        } catch {
          continue;
        }
      }
    }

    throw new Error('Failed to parse quiz from AI response.');
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private unwrapPublicQuizDeck(
    parsed: RawGeneratedPublicQuizDeck,
  ): RawGeneratedPublicQuizDeck {
    let current: RawGeneratedPublicQuizDeck = parsed;
    const nestedKeys: (keyof RawGeneratedPublicQuizDeck)[] = [
      'quiz',
      'deck',
      'publicQuiz',
      'data',
      'result',
    ];

    for (let depth = 0; depth < 4; depth++) {
      const hasQuestions =
        Array.isArray(current.questions) ||
        Array.isArray(current.quizQuestions) ||
        Array.isArray(current.items);
      if (hasQuestions) return current;

      const nestedKey = nestedKeys.find((key) => this.asRecord(current[key]));
      if (!nestedKey) return current;

      const nested = current[nestedKey] as RawGeneratedPublicQuizDeck;
      current = {
        ...nested,
        title: nested.title ?? current.title,
        quizTitle: nested.quizTitle ?? current.quizTitle,
        name: nested.name ?? current.name,
        description: nested.description ?? current.description,
        summary: nested.summary ?? current.summary,
        coveredConcepts: nested.coveredConcepts ?? current.coveredConcepts,
        challengeProfile: nested.challengeProfile ?? current.challengeProfile,
      };
    }

    return current;
  }

  private normalizeCorrectAnswer(
    answer: unknown,
    options: string[],
  ): string | null {
    if (typeof answer !== 'string') return null;
    const trimmed = answer.trim();
    if (!trimmed) return null;

    const exact = options.find((option) => option === trimmed);
    if (exact) return exact;

    const caseInsensitive = options.find(
      (option) => option.toLowerCase() === trimmed.toLowerCase(),
    );
    if (caseInsensitive) return caseInsensitive;

    const letterIndex = /^[A-D]$/i.test(trimmed)
      ? trimmed.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0)
      : null;
    if (letterIndex !== null) return options[letterIndex] ?? null;

    const numericIndex = /^[1-4]$/.test(trimmed) ? Number(trimmed) - 1 : null;
    if (numericIndex !== null) return options[numericIndex] ?? null;

    const prefixedLetter = trimmed.match(/^[A-D][).:\-\s]+(.+)$/i);
    if (prefixedLetter?.[1]) {
      const answerText = prefixedLetter[1].trim();
      return (
        options.find(
          (option) => option.toLowerCase() === answerText.toLowerCase(),
        ) ?? null
      );
    }

    return null;
  }

  private normalizePublicQuizDeck(
    parsed: RawGeneratedPublicQuizDeck,
    questionCount: number,
    fallbackTitle = 'Generated Quiz',
  ): GeneratedPublicQuizDeck {
    const deck = this.unwrapPublicQuizDeck(parsed);
    const titleSource = deck.title ?? deck.quizTitle ?? deck.name;
    const title =
      typeof titleSource === 'string' && titleSource.trim()
        ? titleSource.trim()
        : fallbackTitle;
    const questions = Array.isArray(deck.questions)
      ? deck.questions
      : Array.isArray(deck.quizQuestions)
        ? deck.quizQuestions
        : Array.isArray(deck.items)
          ? deck.items
          : null;

    if (!title || !questions) {
      throw new Error(
        `Expected a non-empty title and exactly ${questionCount} questions, but the response did not include a questions array.`,
      );
    }

    const normalizedQuestions: GeneratedPublicQuizDeck['questions'] = [];
    const invalidQuestions: string[] = [];

    for (let index = 0; index < questions.length; index++) {
      const rawQuestion = questions[index];
      const q =
        rawQuestion && typeof rawQuestion === 'object'
          ? (rawQuestion as RawGeneratedPublicQuizQuestion)
          : {};
      const questionSource = q.question ?? q.prompt ?? q.stem ?? q.text;
      const question =
        typeof questionSource === 'string' ? questionSource.trim() : '';
      const optionsSource = q.options ?? q.choices ?? q.answerOptions;
      const options = Array.isArray(optionsSource)
        ? optionsSource
            .map((option) => {
              if (typeof option === 'string') return option.trim();
              const optionRecord = this.asRecord(option);
              const optionValue =
                optionRecord?.text ??
                optionRecord?.label ??
                optionRecord?.value ??
                optionRecord?.answer;
              return typeof optionValue === 'string' ? optionValue.trim() : '';
            })
            .filter(Boolean)
        : [];
      const answer = this.normalizeCorrectAnswer(
        q.correctAnswer ?? q.correct_answer ?? q.answer ?? q.correct,
        options,
      );
      const explanation =
        typeof q.explanation === 'string'
          ? q.explanation.trim()
          : typeof q.rationale === 'string'
            ? q.rationale.trim()
            : typeof q.reason === 'string'
              ? q.reason.trim()
              : '';

      if (
        !question ||
        options.length !== 4 ||
        new Set(options).size !== 4 ||
        !answer ||
        !explanation
      ) {
        invalidQuestions.push(`${index + 1}`);
        continue;
      }

      normalizedQuestions.push({
        question,
        options,
        correctAnswer: answer,
        explanation,
      });
    }

    if (normalizedQuestions.length < questionCount) {
      const invalidDetails = invalidQuestions.length
        ? ` Invalid question indexes: ${invalidQuestions.join(', ')}.`
        : '';
      throw new Error(
        `Expected exactly ${questionCount} valid questions, but only found ${normalizedQuestions.length} valid question(s) from ${questions.length} returned.${invalidDetails}`,
      );
    }

    if (normalizedQuestions.length > questionCount) {
      normalizedQuestions.length = questionCount;
    }

    return {
      title,
      description:
        typeof deck.description === 'string'
          ? deck.description.trim()
          : undefined,
      summary:
        typeof deck.summary === 'string' ? deck.summary.trim() : undefined,
      coveredConcepts: Array.isArray(deck.coveredConcepts)
        ? deck.coveredConcepts
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
        : undefined,
      challengeProfile:
        typeof deck.challengeProfile === 'string'
          ? deck.challengeProfile.trim()
          : undefined,
      questions: normalizedQuestions,
    };
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
    );
    const response = result?.text ?? '';
    if (!response.trim())
      throw new Error('AI returned empty response. Please try again.');
    let parsed: { title: string; cards: { front: string; back: string }[] };
    try {
      parsed = JSON.parse(response) as typeof parsed;
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
    return parsed;
  }

  async generatePublicQuizDeckContent(
    userId: string,
    topic: string,
    questionCount: number,
  ): Promise<{
    title: string;
    description?: string;
    summary: string;
    coveredConcepts: string[];
    challengeProfile: string;
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
    const history = await getRecentQuizGenerationHistory(userId);
    let retryFeedback = '';
    let accepted: GeneratedPublicQuizDeck | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      const userPayload = [
        `Topic / instructions:\n${topicTrimmed}`,
        '',
        `Generate exactly ${questionCount} multiple-choice questions. Each question must have exactly 4 options; correctAnswer must equal one option exactly. Include a short quiz title, optional one-line description, one-sentence summary, coveredConcepts, and challengeProfile.`,
        '',
        'RECENT QUIZ HISTORY TO AVOID REPEATING:',
        formatQuizHistoryForPrompt(history),
        retryFeedback
          ? `\nPREVIOUS GENERATION WAS REJECTED:\n${retryFeedback}\nGenerate a more varied and more challenging replacement.`
          : '',
      ].join('\n');
      const result = await this.generateWithRetry(() =>
        this.geminiClient.genAI.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: userPayload }] }],
          config: {
            temperature: 0.25,
            maxOutputTokens: Math.min(8192, 520 + questionCount * 300),
            systemInstruction:
              'You create accurate educational multiple-choice quizzes for Web3 and technical topics. Avoid repeating recent quiz summaries, concepts, or question stems. Medium and hard quizzes should favor application, comparison, edge cases, and synthesis over basic definitions. Output must follow the JSON schema exactly.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: {
                  type: Type.STRING,
                  description: 'Short title for the quiz listing',
                },
                description: {
                  type: Type.STRING,
                  description: 'Optional subtitle or scope (one line)',
                },
                summary: {
                  type: Type.STRING,
                  description:
                    'One compact sentence describing what this quiz tests',
                },
                coveredConcepts: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: 'Short concept labels covered by this quiz',
                },
                challengeProfile: {
                  type: Type.STRING,
                  description:
                    'Brief description of the reasoning level and challenge style',
                },
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: { type: Type.STRING },
                      options: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                      },
                      correctAnswer: { type: Type.STRING },
                      explanation: { type: Type.STRING },
                    },
                    required: [
                      'question',
                      'options',
                      'correctAnswer',
                      'explanation',
                    ],
                  },
                },
              },
              required: [
                'title',
                'summary',
                'coveredConcepts',
                'challengeProfile',
                'questions',
              ],
            },
          },
        }),
      );
      const response = result?.text ?? '';
      if (!response.trim())
        throw new Error('AI returned empty response. Please try again.');
      let parsed: GeneratedPublicQuizDeck;
      try {
        parsed = this.normalizePublicQuizDeck(
          this.parseGeneratedJsonObject(response),
          questionCount,
          topicTrimmed,
        );
      } catch (parseError) {
        retryFeedback =
          parseError instanceof Error
            ? parseError.message
            : 'The previous response was malformed JSON.';
        if (attempt === 2) {
          throw parseError;
        }
        continue;
      }
      const diversity = validateQuizDiversity({
        questions: parsed.questions,
        history,
        difficulty: 'medium',
      });
      if (diversity.ok) {
        accepted = parsed;
        break;
      }
      retryFeedback = diversity.feedback;
      if (attempt === 2) {
        throw new Error(`Generated quiz is too repetitive. ${diversity.feedback}`);
      }
    }
    if (!accepted) {
      throw new Error('Failed to generate a diverse quiz. Please try again.');
    }
    if (
      !accepted.title?.trim() ||
      !Array.isArray(accepted.questions) ||
      accepted.questions.length !== questionCount
    ) {
      throw new Error(
        `Expected exactly ${questionCount} questions and a non-empty title. Please try again.`,
      );
    }
    const fallbackMetadata = buildQuizMetadataFromQuestions(
      accepted.title,
      accepted.questions,
      'medium',
    );
    return {
      title: accepted.title.trim(),
      description: accepted.description?.trim(),
      summary: accepted.summary?.trim() || fallbackMetadata.summary,
      coveredConcepts: Array.isArray(accepted.coveredConcepts)
        ? accepted.coveredConcepts
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, 12)
        : fallbackMetadata.coveredConcepts,
      challengeProfile:
        accepted.challengeProfile?.trim() || fallbackMetadata.challengeProfile,
      questions: accepted.questions,
    };
  }
}
