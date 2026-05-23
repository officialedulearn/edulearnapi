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

type QuizQuestion = {
  question?: string;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
};

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
                  model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
                  attempt: attempts + 1,
                },
              },
              () =>
                this.geminiClient.genAI.models.generateContent({
                  model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
                  contents: conversationContext,
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

      if (!Array.isArray(quizQuestions) || quizQuestions.length === 0) {
        throw new Error(
          'Unable to generate quiz questions from this conversation. The discussion may not contain enough educational content.',
        );
      }

      if (quizQuestions.length !== 10) {
        console.warn(
          `Quiz generation produced ${quizQuestions.length} questions instead of 10. Retrying...`,
        );
        throw new Error(
          `Generated quiz has incorrect number of questions (${quizQuestions.length}/10). Expected exactly 10 questions.`,
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
  }): Promise<any[]> {
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
      const contents = [
        `TOPIC: ${topicTrimmed}`,
        '',
        'LEARNER CONTEXT (from recent activity; may be empty):',
        memoryContext?.trim() || '(none)',
      ].join('\n');
      const systemInstruction =
        buildScheduledQuizSystemInstruction(difficulty);
      let quizQuestions: QuizQuestion[] | null = null;
      let attempts = 0;
      const maxAttempts = 3;
      while (attempts < maxAttempts) {
        try {
          const result = (await Promise.race([
            startSentrySpan(
              {
                name: 'Generate scheduled quiz with Gemini',
                op: 'ai.gemini.generate_scheduled_quiz',
                attributes: {
                  model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
                  attempt: attempts + 1,
                  difficulty,
                },
              },
              () =>
                this.geminiClient.genAI.models.generateContent({
                  model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
                  contents,
                  config: {
                    temperature: 0.1,
                    maxOutputTokens: 5000,
                    systemInstruction,
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
          ])) as { text?: string };

          const response = result.text ?? '';
          if (!response || !response.trim().length) {
            throw new Error(
              'AI service returned empty response. Please try again.',
            );
          }

          const cleanedResponse = this.cleanQuizJSON(response);
          if (!cleanedResponse.endsWith(']')) {
            throw new Error(
              'Quiz generation was truncated. Retrying with adjusted parameters...',
            );
          }

          const parsedQuestions = this.parseQuizJSONArray(
            cleanedResponse,
            'scheduled quiz',
          );

          if (parsedQuestions.length === 0) {
            throw new Error(
              'The topic could not be used to generate quiz questions. Try a more specific topic.',
            );
          }
          if (parsedQuestions.length !== 10) {
            throw new Error(
              `Generated quiz has incorrect number of questions (${parsedQuestions.length}/10). Expected exactly 10 questions.`,
            );
          }

          for (let i = 0; i < parsedQuestions.length; i++) {
            const q = parsedQuestions[i];
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

          quizQuestions = parsedQuestions;
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
      if (!quizQuestions) {
        throw new Error('Failed to generate quiz from AI service');
      }
      try {
        await this.authService.deductUserCredits(userId);
        creditsDeducted = true;
        return quizQuestions;
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
}
