import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import db from '../../drizzle';
import { eq, desc, and, gte } from 'drizzle-orm';
import { chat, message, publicQuiz, user } from '../../lib/db/schema';
import { AiService } from '../ai/ai.service';
import { NotificationsService } from '../common/services/notifications.service';
import { ActivityService } from '../activity/activity.service';

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

@Injectable()
export class QuizGenerationService {
  private readonly logger = new Logger(QuizGenerationService.name);

  constructor(
    private readonly aiService: AiService,
    private readonly notificationsService: NotificationsService,
    private readonly activityService: ActivityService,
  ) {}

  /**
   * Generate a quiz based on the user's recent learning history
   * Fetches recent chat messages, passes to AI for generation,
   * and creates a quiz notification
   */
  async generateQuizFromRecentLearning(
    userId: string,
    daysBack: number = 3,
  ): Promise<{ quizId: string; title: string; notificationSent: boolean }> {
    try {
      // 1. Get user info
      const [userRecord] = await db
        .select()
        .from(user)
        .where(eq(user.id, userId));

      if (!userRecord) {
        throw new NotFoundException(`User ${userId} not found`);
      }

      // 2. Fetch recent chat sessions (within daysBack)
      const dateThreshold = new Date();
      dateThreshold.setDate(dateThreshold.getDate() - daysBack);

      const recentChats = await db
        .select({
          chatId: chat.id,
          chatTitle: chat.title,
          createdAt: chat.createdAt,
        })
        .from(chat)
        .where(and(eq(chat.userId, userId), gte(chat.createdAt, dateThreshold)))
        .orderBy(desc(chat.createdAt))
        .limit(5); // Get up to 5 recent chats

      if (recentChats.length === 0) {
        throw new NotFoundException(
          `No recent learning activity found for user ${userId} in the last ${daysBack} days`,
        );
      }

      // 3. Fetch messages from the most recent chat
      const mostRecentChat = recentChats[0];
      const chatMessages = await db
        .select()
        .from(message)
        .where(eq(message.chatId, mostRecentChat.chatId))
        .orderBy(message.createdAt)
        .limit(50);

      if (chatMessages.length === 0) {
        throw new NotFoundException(
          `No messages found in chat ${mostRecentChat.chatId}`,
        );
      }

      // 4. Build conversation context for AI
      const conversationText = chatMessages
        .map(
          (m) =>
            `${m.role === 'user' ? 'User' : 'Assistant'}: ${
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content)
            }`,
        )
        .join('\n');

      // 5. Call AI service to generate quiz
      const generatedQuestions = await this.aiService.generateQuizQuestions(
        conversationText,
      );

      if (!generatedQuestions || generatedQuestions.length === 0) {
        throw new Error('AI service did not generate any questions');
      }

      // 6. Determine quiz title from chat or topic
      const quizTitle = this.generateQuizTitle(
        mostRecentChat.chatTitle,
        generatedQuestions,
      );

      // 7. Create quiz in database
      const [createdQuiz] = await db
        .insert(publicQuiz)
        .values({
          title: quizTitle,
          description: `Auto-generated quiz from your ${mostRecentChat.chatTitle} discussion`,
          questions: generatedQuestions as unknown as Record<string, unknown>,
          createdBy: userId,
          sourceChatId: mostRecentChat.chatId,
        })
        .returning();

      this.logger.log(
        `Generated quiz ${createdQuiz.id} for user ${userId} from chat ${mostRecentChat.chatId}`,
      );

      // 8. Send notification to user
      let notificationSent = false;
      if (userRecord.expoPushToken) {
        try {
          await this.notificationsService.createNotification(
            {
              title: '🎯 New Quiz Available!',
              content: `Test your knowledge: ${quizTitle}`,
              userId: userId,
            },
            true, // sendPush = true
          );
          notificationSent = true;
          this.logger.log(
            `Notification sent to user ${userId} for quiz ${createdQuiz.id}`,
          );
        } catch (notificationError) {
          this.logger.warn(
            `Failed to send notification: ${(notificationError as Error)?.message}`,
          );
          // Don't fail the whole operation if notification fails
          notificationSent = false;
        }
      }

      return {
        quizId: createdQuiz.id,
        title: createdQuiz.title,
        notificationSent,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate quiz for user ${userId}`,
        (error as Error)?.stack,
      );
      throw error;
    }
  }

  /**
   * Generate a human-readable quiz title from chat title and content
   */
  private generateQuizTitle(
    chatTitle: string,
    questions: QuizQuestion[],
  ): string {
    // Extract a topic from the first question or use chat title
    if (questions.length > 0 && questions[0].question) {
      const firstQuestion = questions[0].question;
      // Extract topic from question (first 30 chars)
      const topic = firstQuestion.substring(0, 40).trim();
      return `Quiz: ${topic}...`;
    }

    return `Quiz: ${chatTitle}`;
  }

  /**
   * Get a user's generated quizzes (from their learning history)
   */
  async getUserGeneratedQuizzes(userId: string, limit: number = 10) {
    try {
      const quizzes = await db
        .select({
          id: publicQuiz.id,
          title: publicQuiz.title,
          description: publicQuiz.description,
          createdAt: publicQuiz.createdAt,
          viewCount: publicQuiz.viewCount,
          attemptCount: publicQuiz.attemptCount,
          sourceChatId: publicQuiz.sourceChatId,
        })
        .from(publicQuiz)
        .where(eq(publicQuiz.createdBy, userId))
        .orderBy(desc(publicQuiz.createdAt))
        .limit(limit);

      return quizzes;
    } catch (error) {
      this.logger.error(
        `Failed to fetch quizzes for user ${userId}`,
        (error as Error)?.stack,
      );
      throw error;
    }
  }

  /**
   * Schedule automatic quiz generation for a user
   * Can be called by a cron job or manually triggered
   */
  async scheduleQuizGeneration(userId: string): Promise<void> {
    try {
      // Check when user last got a quiz (optional rate limiting)
      const recentGeneratedQuizzes = await db
        .select()
        .from(publicQuiz)
        .where(eq(publicQuiz.createdBy, userId))
        .orderBy(desc(publicQuiz.createdAt))
        .limit(1);

      const lastQuizTime = recentGeneratedQuizzes[0]?.createdAt;
      const now = new Date();
      const hoursSinceLastQuiz = lastQuizTime
        ? (now.getTime() - lastQuizTime.getTime()) / (1000 * 60 * 60)
        : 24;

      // Only generate if at least 6 hours have passed since last quiz
      if (hoursSinceLastQuiz < 6) {
        this.logger.log(
          `Skipping quiz generation for user ${userId} - recently generated`,
        );
        return;
      }

      // Generate quiz
      const result = await this.generateQuizFromRecentLearning(userId, 1);
      this.logger.log(
        `Scheduled quiz generation completed for user ${userId}: ${result.quizId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Scheduled quiz generation failed for user ${userId}: ${(error as Error)?.message}`,
      );
      // Don't throw - this is a background task
    }
  }
}
