import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { QuizGenerationService } from 'src/ai/quiz-generation.service';
import { NotificationsService } from 'src/common/services/notifications.service';
import { ChatService } from 'src/chat/chat.service';
import db from '../../drizzle';
import { quizGenerationSchedule, user } from '../../lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { QuizScheduleBullmqService } from './quiz-schedule-bullmq.service';
import { QUIZ_SCHEDULE_QUEUE_NAME } from './quiz-schedule.constants';
import type { QuizScheduleJobData } from './quiz-schedule.types';
import { QuizzesService } from './quizzes.service';

@Injectable()
export class QuizScheduleProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(QuizScheduleProcessorService.name);
  private worker: Worker<QuizScheduleJobData> | null = null;
  private workerConnection: Redis | null = null;

  constructor(
    private readonly bullmq: QuizScheduleBullmqService,
    private readonly quizGenerationService: QuizGenerationService,
    private readonly quizzesService: QuizzesService,
    private readonly notificationsService: NotificationsService,
    private readonly chatService: ChatService,
  ) {}

  onModuleInit() {
    this.workerConnection = this.bullmq.duplicateConnection();
    this.worker = new Worker<QuizScheduleJobData>(
      QUIZ_SCHEDULE_QUEUE_NAME,
      async (job: Job<QuizScheduleJobData>) => this.processJob(job),
      { connection: this.workerConnection, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Scheduled quiz job ${job?.id} failed: ${err?.message}`,
        err?.stack,
      );
    });
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.workerConnection) {
      await this.workerConnection.quit();
      this.workerConnection = null;
    }
  }

  private async processJob(job: Job<QuizScheduleJobData>) {
    const userId = job.data?.userId;
    if (!userId) {
      this.logger.warn('Scheduled quiz job missing userId');
      return;
    }
    const [schedule] = await db
      .select()
      .from(quizGenerationSchedule)
      .where(
        and(
          eq(quizGenerationSchedule.userId, userId),
          eq(quizGenerationSchedule.enabled, true),
        ),
      )
      .limit(1);
    if (!schedule) {
      this.logger.log(`No enabled schedule for user ${userId}, skipping`);
      return;
    }
    const [u] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!u) {
      this.logger.warn(`User ${userId} not found for scheduled quiz`);
      return;
    }
    const credits = Number(u.credits ?? 0);
    if (credits < 0.5) {
      this.logger.log(`User ${userId} low credits, skipping scheduled quiz`);
      await this.notificationsService.createNotification(
        {
          userId,
          title: 'Scheduled quiz skipped',
          content:
            'Your scheduled quiz did not run because you need at least 0.5 credits.',
        },
        true,
      );
      return;
    }
    const memoryContext =
      await this.chatService.getLearningContextSnippetForUser(userId);
    let questions: Array<{
      question: string;
      options: string[];
      correctAnswer: string;
      explanation: string;
    }>;
    try {
      questions = await this.quizGenerationService.generateScheduledQuiz({
        userId,
        topic: schedule.topic,
        difficulty: schedule.difficulty as 'easy' | 'medium' | 'hard',
        memoryContext,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`generateScheduledQuiz failed for ${userId}: ${msg}`);
      throw err;
    }
    const dateLabel = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const published = await this.quizzesService.publish(userId, {
      title: `${schedule.topic} — ${dateLabel}`,
      description: `Scheduled ${schedule.difficulty} quiz`,
      questions,
      sourceChatId: undefined,
    });
    await this.notificationsService.createNotification(
      {
        userId,
        title: 'Your quiz is ready',
        content: `A new quiz "${published.title}" was generated from your schedule.`,
      },
      true,
    );
  }
}
