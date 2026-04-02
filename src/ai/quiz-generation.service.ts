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
import { QUIZ_SYSTEM_INSTRUCTION } from './prompts/quiz-system-prompt';
import { GeminiClientService } from './gemini-client.service';

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

      let quizQuestions;
      try {
        quizQuestions = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error('Failed to parse quiz JSON:', parseError);
        console.error(
          'Cleaned JSON that failed (first 1000 chars):',
          cleanedResponse.substring(0, 1000),
        );
        console.error(
          'Cleaned JSON that failed (last 500 chars):',
          cleanedResponse.substring(Math.max(0, cleanedResponse.length - 500)),
        );
        throw new Error(
          `Failed to parse quiz questions from AI response. The AI returned malformed JSON. Please try again.`,
        );
      }

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
}
