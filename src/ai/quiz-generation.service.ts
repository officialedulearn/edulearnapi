import { Type } from '@google/genai';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { AuthService } from 'src/auth/auth.service';
import { ChatService } from 'src/chat/chat.service';
import {
  QUIZ_SYSTEM_INSTRUCTION,
  buildScheduledQuizSystemInstruction,
} from './prompts/quiz-system-prompt';
import { GeminiClientService } from './gemini-client.service';
import { startSentrySpan } from 'src/observability/sentry';
import {
  buildQuizMetadataFromQuestions,
  formatQuizHistoryForPrompt,
  QuizGenerationMetadata,
  validateQuizDiversity,
} from './quiz-diversity.util';
import { getRecentQuizGenerationHistory } from 'src/quizzes/quiz-generation-history';

type QuizQuestion = {
  question?: string;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
};

type GeneratedScheduledQuiz = QuizGenerationMetadata & {
  questions: Required<QuizQuestion>[];
};

export type RoadmapVerificationQuizQuestion = Required<QuizQuestion>;

@Injectable()
export class QuizGenerationService {
  constructor(
    private readonly geminiClient: GeminiClientService,
    private readonly chatService: ChatService,
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

  private cleanQuizJSON(response: string): string {
    let cleaned = response.trim();

    if (cleaned.includes('```json')) {
      const jsonMatch = cleaned.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleaned = jsonMatch[1].trim();
      }
    } else if (cleaned.includes('```')) {
      const codeMatch = cleaned.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        cleaned = codeMatch[1].trim();
      }
    }

    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');

    if (arrayStart !== -1 && arrayEnd !== -1 && arrayStart < arrayEnd) {
      cleaned = cleaned.substring(arrayStart, arrayEnd + 1);
    }

    cleaned = cleaned.replace(
      /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g,
      '',
    );

    cleaned = cleaned.replace(/\n/g, ' ').replace(/\r/g, '');

    cleaned = cleaned.replace(/\s+/g, ' ');

    cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');

    cleaned = cleaned.replace(/,\s*,/g, ',');

    return cleaned.trim();
  }

  private cleanJSONValue(response: string): string {
    let cleaned = response.trim();

    if (cleaned.includes('```json')) {
      const jsonMatch = cleaned.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) cleaned = jsonMatch[1].trim();
    } else if (cleaned.includes('```')) {
      const codeMatch = cleaned.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) cleaned = codeMatch[1].trim();
    }

    cleaned = cleaned.replace(
      /[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g,
      '',
    );
    cleaned = cleaned.replace(/\n/g, ' ').replace(/\r/g, '');
    cleaned = cleaned.replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');
    cleaned = cleaned.replace(/,\s*,/g, ',');
    return cleaned.trim();
  }

  private attemptQuizJSONArrayFix(jsonStr: string): string | null {
    try {
      let fixed = jsonStr.trim();

      const arrayStart = fixed.indexOf('[');
      const arrayEnd = fixed.lastIndexOf(']');

      if (arrayStart !== -1) {
        fixed =
          arrayEnd !== -1 && arrayEnd > arrayStart
            ? fixed.substring(arrayStart, arrayEnd + 1)
            : fixed.substring(arrayStart);
      }

      fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

      let openBraces = 0;
      let openBrackets = 0;
      let inString = false;
      let escaped = false;

      for (let i = 0; i < fixed.length; i++) {
        const char = fixed[i];

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

        if (!inString) {
          if (char === '{') openBraces++;
          else if (char === '}') openBraces--;
          else if (char === '[') openBrackets++;
          else if (char === ']') openBrackets--;
        }
      }

      if (inString) {
        fixed += '"';
      }

      while (openBraces > 0) {
        fixed += '}';
        openBraces--;
      }
      while (openBrackets > 0) {
        fixed += ']';
        openBrackets--;
      }

      return fixed;
    } catch (error) {
      console.error('Error attempting quiz JSON fix:', error);
      return null;
    }
  }

  private parseQuizJSONArray(
    cleanedResponse: string,
    contextLabel: 'quiz' | 'scheduled quiz',
  ): QuizQuestion[] {
    try {
      const parsed = JSON.parse(cleanedResponse) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('Response is not a JSON array');
      }
      return parsed as QuizQuestion[];
    } catch (parseError) {
      console.error(`Failed to parse ${contextLabel} JSON:`, parseError);
      console.error(
        `Cleaned ${contextLabel} JSON that failed (first 1000 chars):`,
        cleanedResponse.substring(0, 1000),
      );
      console.error(
        `Cleaned ${contextLabel} JSON that failed (last 500 chars):`,
        cleanedResponse.substring(Math.max(0, cleanedResponse.length - 500)),
      );

      const fixed = this.attemptQuizJSONArrayFix(cleanedResponse);
      if (fixed && fixed !== cleanedResponse) {
        try {
          const repaired = JSON.parse(fixed) as unknown;
          if (Array.isArray(repaired)) {
            console.warn(
              `Recovered malformed ${contextLabel} JSON with repair pass.`,
            );
            return repaired as QuizQuestion[];
          }
        } catch (repairError) {
          console.error(
            `Repair parse for ${contextLabel} JSON failed:`,
            repairError,
          );
        }
      }

      throw new Error(
        `Failed to parse quiz questions from AI response. The AI returned malformed JSON. Please try again.`,
      );
    }
  }

  private assertValidQuizQuestions(
    quizQuestions: QuizQuestion[],
    expectedCount: number,
  ): asserts quizQuestions is Required<QuizQuestion>[] {
    if (!Array.isArray(quizQuestions) || quizQuestions.length === 0) {
      throw new Error(
        'Unable to generate quiz questions from this content. The input may not contain enough educational content.',
      );
    }
    if (quizQuestions.length !== expectedCount) {
      throw new Error(
        `Generated quiz has incorrect number of questions (${quizQuestions.length}/${expectedCount}). Expected exactly ${expectedCount} questions.`,
      );
    }
    for (let i = 0; i < quizQuestions.length; i++) {
      const q = quizQuestions[i];
      if (
        !q.question ||
        !Array.isArray(q.options) ||
        q.options.length !== 4 ||
        !q.correctAnswer ||
        !q.explanation
      ) {
        throw new Error(
          `Question ${i + 1} has invalid structure. All questions must have: question, 4 options, correctAnswer, and explanation.`,
        );
      }
      if (!q.options.includes(q.correctAnswer)) {
        throw new Error(
          `Question ${i + 1}: correctAnswer "${q.correctAnswer}" does not match any of the provided options.`,
        );
      }
    }
  }

  async generateQuiz({
    chatId,
    userId,
  }: {
    chatId: string;
    userId: string;
  }): Promise<any> {
    let chatMarkedAsTested = false;
    let creditsDeducted = false;
    let quizLimitDeducted = false;

    try {
      if (!chatId || !userId) {
        throw new Error('Chat ID and User ID are required');
      }
      const chat = await this.chatService.getChatById(chatId);
      if (!chat) {
        throw new NotFoundException('Chat not found');
      }
      if (chat.userId !== userId) {
        throw new ForbiddenException(
          'You do not have permission to access this chat',
        );
      }
      if (chat.tested && (chat.testLimit || 0) <= 0) {
        throw new ForbiddenException(
          'This chat has already been tested. Each chat can only be used for one quiz.',
        );
      }

      const currentTestLimit = chat.testLimit || 0;
      if (currentTestLimit <= 0) {
        throw new ForbiddenException(
          'This chat has no remaining quiz attempts. Please start a new chat to generate another quiz.',
        );
      }
      const userCredits = await this.checkUserCredits(userId);
      if (userCredits < 0.5) {
        throw new ForbiddenException(
          'Insufficient credits. You need at least 0.5 credits to generate a quiz.',
        );
      }

      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const quizLimits = user.quizLimits || 0;
      if (quizLimits <= 0) {
        throw new ForbiddenException(
          'No quiz attempts left for today. Quiz limits reset daily.',
        );
      }

      const messages = await this.chatService.getMessagesInChat(chatId);
      if (!messages || messages.length === 0) {
        throw new Error(
          'No messages found in this chat. A conversation is needed to generate a quiz.',
        );
      }

      const userMessages = messages.filter((msg) => msg.role === 'user');
      if (userMessages.length < 2) {
        throw new Error(
          'Not enough conversation content. Have at least 2 exchanges with the AI to generate a meaningful quiz.',
        );
      }

      const MAX_MESSAGES_FOR_QUIZ = 50;
      const recentMessages = messages.slice(-MAX_MESSAGES_FOR_QUIZ);

      const conversationContext = recentMessages
        .map(
          (msg) =>
            `${msg.role}: ${typeof msg.content === 'string' ? msg.content : msg.content}`,
        )
        .join('\n\n');
      const history = await getRecentQuizGenerationHistory(userId);
      const generationContext = [
        conversationContext,
        '',
        'RECENT QUIZ HISTORY TO AVOID REPEATING:',
        formatQuizHistoryForPrompt(history),
      ].join('\n');

      let result;
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        try {
          result = await Promise.race([
            startSentrySpan(
              {
                name: 'Generate quiz with Gemini',
                op: 'ai.gemini.generate_quiz',
                attributes: {
                  model: user?.isPremium
                    ? 'gemini-2.5-pro'
                    : 'gemini-2.5-flash',
                  attempt: attempts + 1,
                },
              },
              () =>
                this.geminiClient.genAI.models.generateContent({
                  model: user?.isPremium
                    ? 'gemini-2.5-pro'
                    : 'gemini-2.5-flash',
                  contents: generationContext,
                  config: {
                    temperature: 0.1,
                    maxOutputTokens: 5000,
                    systemInstruction: QUIZ_SYSTEM_INSTRUCTION,
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          question: {
                            type: Type.STRING,
                            description: 'The quiz question text',
                          },
                          options: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING },
                            description: 'Array of exactly 4 answer options',
                          },
                          correctAnswer: {
                            type: Type.STRING,
                            description:
                              'The correct answer, must match one of the options',
                          },
                          explanation: {
                            type: Type.STRING,
                            description:
                              'Explanation of why this is the correct answer',
                          },
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
                }),
            ),
            new Promise((_, reject) =>
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
          console.error(
            `Quiz generation attempt ${attempts} failed:`,
            attemptError,
          );

          if (attempts >= maxAttempts) {
            const msg =
              attemptError instanceof Error
                ? attemptError.message
                : 'AI service unavailable';
            throw new Error(
              `Failed to generate quiz after ${maxAttempts} attempts. ${msg}`,
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (!result) {
        throw new Error('Failed to get response from AI service');
      }

      const response = result.text ?? '';

      if (!response || response.trim().length === 0) {
        throw new Error(
          'AI service returned empty response. Please try again.',
        );
      }

      const cleanedResponse = this.cleanQuizJSON(response);

      console.log('Raw quiz response length:', response.length);
      console.log(
        'Raw quiz response (first 500 chars):',
        response.substring(0, 500),
      );
      console.log(
        'Cleaned quiz JSON (first 500 chars):',
        cleanedResponse.substring(0, 500),
      );
      console.log(
        'Cleaned quiz JSON (last 100 chars):',
        cleanedResponse.substring(cleanedResponse.length - 100),
      );

      if (!cleanedResponse.endsWith(']')) {
        console.warn('Quiz JSON appears to be truncated - does not end with ]');
        throw new Error(
          'Quiz generation was truncated. Retrying with adjusted parameters...',
        );
      }

      const quizQuestions = this.parseQuizJSONArray(cleanedResponse, 'quiz');

      this.assertValidQuizQuestions(quizQuestions, 10);
      const diversity = validateQuizDiversity({
        questions: quizQuestions,
        history,
        difficulty: 'medium',
      });
      if (!diversity.ok) {
        throw new Error(`Generated quiz is too repetitive. ${diversity.feedback}`);
      }

      try {
        const newTestLimit = (chat.testLimit || 0) - 1;

        await this.chatService.decrementTestLimit(chatId);

        if (newTestLimit <= 0) {
          await this.chatService.markChatAsTested(chatId);
          chatMarkedAsTested = true;
        }

        await this.authService.deductUserCredits(userId);
        creditsDeducted = true;

        await this.authService.deductQuizLimit(userId);
        quizLimitDeducted = true;
        return quizQuestions;
      } catch (_operationError) {
        throw new Error(
          'Quiz generated successfully but failed to update user account. Please contact support.',
        );
      }
    } catch (error) {
      if (chatMarkedAsTested || creditsDeducted || quizLimitDeducted) {
        try {
          console.error(
            `Rollback needed for user ${userId}, chat ${chatId}. Operations completed: chatTested=${chatMarkedAsTested}, creditsDeducted=${creditsDeducted}, quizLimitDeducted=${quizLimitDeducted}`,
          );
        } catch (rollbackError) {
          console.error('Failed to rollback operations:', rollbackError);
        }
      }
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      if (error instanceof Error && error.message) {
        if (error.message.includes('timeout')) {
          throw new Error(
            'Request timed out. The AI service is currently slow. Please try again in a few moments.',
          );
        }
        if (error.message.includes('credits')) {
          throw new ForbiddenException(error.message);
        }
        if (
          error.message.includes('quiz attempts') ||
          error.message.includes('Quiz limits')
        ) {
          throw new ForbiddenException(error.message);
        }
        if (
          error.message.includes('conversation content') ||
          error.message.includes('educational content')
        ) {
          throw new Error(error.message);
        }
      }

      throw new Error(
        'Unable to generate quiz at this time. Please ensure you have an educational conversation and try again later.',
      );
    }
  }

  async generateScheduledQuiz({
    userId,
    topic,
    difficulty,
    memoryContext,
  }: {
    userId: string;
    topic: string;
    difficulty: 'easy' | 'medium' | 'hard';
    memoryContext: string;
  }): Promise<GeneratedScheduledQuiz> {
    let creditsDeducted = false;
    const topicTrimmed = topic?.trim() ?? '';
    if (!userId || !topicTrimmed) {
      throw new Error('User ID and topic are required');
    }
    try {
      const userCredits = await this.checkUserCredits(userId);
      if (userCredits < 0.5) {
        throw new ForbiddenException(
          'Insufficient credits. You need at least 0.5 credits to generate a quiz.',
        );
      }
      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }
      const history = await getRecentQuizGenerationHistory(userId);
      let retryFeedback = '';
      const systemInstruction = buildScheduledQuizSystemInstruction(difficulty);
      let generatedQuiz: GeneratedScheduledQuiz | null = null;
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          const contents = [
            `TOPIC: ${topicTrimmed}`,
            '',
            'LEARNER CONTEXT (from recent activity; may be empty):',
            memoryContext?.trim() || '(none)',
            '',
            'RECENT QUIZ HISTORY TO AVOID REPEATING:',
            formatQuizHistoryForPrompt(history),
            retryFeedback
              ? `\nPREVIOUS GENERATION WAS REJECTED:\n${retryFeedback}\nGenerate a more varied and more challenging replacement.`
              : '',
          ].join('\n');
          const result = (await Promise.race([
            startSentrySpan(
              {
                name: 'Generate scheduled quiz with Gemini',
                op: 'ai.gemini.generate_scheduled_quiz',
                attributes: {
                  model: user?.isPremium
                    ? 'gemini-2.5-pro'
                    : 'gemini-2.5-flash',
                  attempt: attempts + 1,
                  difficulty,
                },
              },
              () =>
                this.geminiClient.genAI.models.generateContent({
                  model: user?.isPremium
                    ? 'gemini-2.5-pro'
                    : 'gemini-2.5-flash',
                  contents,
                  config: {
                    temperature: 0.1,
                    maxOutputTokens: 5000,
                    systemInstruction,
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        summary: {
                          type: Type.STRING,
                          description:
                            'One compact sentence describing what this quiz tests',
                        },
                        coveredConcepts: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                          description:
                            'Short concept labels covered by this quiz',
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
                              question: {
                                type: Type.STRING,
                                description: 'The quiz question text',
                              },
                              options: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING },
                                description: 'Array of exactly 4 answer options',
                              },
                              correctAnswer: {
                                type: Type.STRING,
                                description:
                                  'The correct answer, must match one of the options',
                              },
                              explanation: {
                                type: Type.STRING,
                                description:
                                  'Explanation of why this is the correct answer',
                              },
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
                        'summary',
                        'coveredConcepts',
                        'challengeProfile',
                        'questions',
                      ],
                    },
                  },
                }),
            ),
            new Promise((_, reject) =>
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
          ])) as { text?: string };

          const response = result.text ?? '';
          if (!response || !response.trim().length) {
            throw new Error(
              'AI service returned empty response. Please try again.',
            );
          }

          const cleanedResponse = this.cleanJSONValue(response);
          const parsed = JSON.parse(cleanedResponse) as Partial<
            QuizGenerationMetadata & { questions: QuizQuestion[] }
          >;
          const parsedQuestions = parsed.questions ?? [];
          this.assertValidQuizQuestions(parsedQuestions, 10);
          const diversity = validateQuizDiversity({
            questions: parsedQuestions,
            history,
            difficulty,
          });
          if (!diversity.ok) {
            retryFeedback = diversity.feedback;
            throw new Error(`Generated quiz is too repetitive. ${diversity.feedback}`);
          }

          const fallbackMetadata = buildQuizMetadataFromQuestions(
            topicTrimmed,
            parsedQuestions,
            difficulty,
          );
          generatedQuiz = {
            questions: parsedQuestions,
            summary: parsed.summary?.trim() || fallbackMetadata.summary,
            coveredConcepts: Array.isArray(parsed.coveredConcepts)
              ? parsed.coveredConcepts
                  .filter((item): item is string => typeof item === 'string')
                  .map((item) => item.trim())
                  .filter(Boolean)
                  .slice(0, 12)
              : fallbackMetadata.coveredConcepts,
            challengeProfile:
              parsed.challengeProfile?.trim() ||
              fallbackMetadata.challengeProfile,
          };
          break;
        } catch (attemptError) {
          attempts++;
          console.error(
            `Scheduled quiz generation attempt ${attempts} failed:`,
            attemptError,
          );
          if (attempts >= maxAttempts) {
            const msg =
              attemptError instanceof Error
                ? attemptError.message
                : 'AI service unavailable';
            throw new Error(
              `Failed to generate quiz after ${maxAttempts} attempts. ${msg}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      if (!generatedQuiz) {
        throw new Error('Failed to generate quiz from AI service');
      }
      try {
        await this.authService.deductUserCredits(userId);
        creditsDeducted = true;
        return generatedQuiz;
      } catch (_operationError) {
        throw new Error(
          'Quiz generated successfully but failed to update user account. Please contact support.',
        );
      }
    } catch (error) {
      if (creditsDeducted) {
        console.error(
          `Scheduled quiz rollback note for user ${userId}: creditsDeducted=${creditsDeducted}`,
        );
      }
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      if (error instanceof Error && error.message) {
        if (error.message.includes('timeout')) {
          throw new Error(
            'Request timed out. The AI service is currently slow. Please try again in a few moments.',
          );
        }
        if (error.message.includes('credits')) {
          throw new ForbiddenException(error.message);
        }
      }
      throw new Error(
        'Unable to generate scheduled quiz at this time. Please try again later.',
      );
    }
  }

  async generateRoadmapVerificationQuiz({
    userId,
    roadmapTitle,
    stepTitle,
    stepDescription,
    subStepTitle,
    subStepDescription,
    subStepContext,
  }: {
    userId: string;
    roadmapTitle: string;
    stepTitle: string;
    stepDescription: string;
    subStepTitle: string;
    subStepDescription: string;
    subStepContext?: string | null;
  }): Promise<RoadmapVerificationQuizQuestion[]> {
    if (!userId || !subStepTitle?.trim() || !subStepDescription?.trim()) {
      throw new Error('User ID and sub-step content are required');
    }

    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const systemInstruction = `Generate EXACTLY 5 private multiple-choice verification questions for a roadmap checkpoint.

These questions verify whether the learner can complete the specific checkpoint, not whether they memorized the whole roadmap.

CRITICAL REQUIREMENTS:
- YOU MUST GENERATE EXACTLY 5 QUESTIONS
- Each question MUST have exactly 4 options
- The correctAnswer MUST be one of the 4 options (exact match)
- All fields required: question, options, correctAnswer, explanation
- Questions should test practical understanding, sequencing, definitions, and application tied to the checkpoint
- Do not include leaderboard, public quiz, multiplayer, or discovery language

Return ONLY valid JSON matching the schema.`;

    const contents = [
      `ROADMAP: ${roadmapTitle}`,
      `STEP: ${stepTitle}`,
      `STEP DESCRIPTION: ${stepDescription}`,
      `CHECKPOINT: ${subStepTitle}`,
      `CHECKPOINT DESCRIPTION: ${subStepDescription}`,
      `CHECKPOINT CONTEXT: ${subStepContext?.trim() || '(none)'}`,
    ].join('\n');

    let result;
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      try {
        result = await Promise.race([
          startSentrySpan(
            {
              name: 'Generate roadmap verification quiz with Gemini',
              op: 'ai.gemini.generate_roadmap_verification_quiz',
              attributes: {
                model: user.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
                attempt: attempts + 1,
              },
            },
            () =>
              this.geminiClient.genAI.models.generateContent({
                model: user.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
                contents,
                config: {
                  temperature: 0.15,
                  maxOutputTokens: 3000,
                  systemInstruction,
                  responseMimeType: 'application/json',
                  responseSchema: {
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
              }),
          ),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('Request timeout - AI service took too long')),
              90000,
            ),
          ),
        ]);
        break;
      } catch (attemptError) {
        attempts++;
        console.error(
          `Roadmap verification quiz generation attempt ${attempts} failed:`,
          attemptError,
        );
        if (attempts >= maxAttempts) {
          const msg =
            attemptError instanceof Error
              ? attemptError.message
              : 'AI service unavailable';
          throw new Error(
            `Failed to generate verification quiz after ${maxAttempts} attempts. ${msg}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    const response = (result as { text?: string } | undefined)?.text ?? '';
    if (!response.trim()) {
      throw new Error('AI service returned empty verification quiz response');
    }

    const questions = this.parseQuizJSONArray(
      this.cleanQuizJSON(response),
      'quiz',
    );
    this.assertValidQuizQuestions(questions, 5);
    return questions;
  }
}
