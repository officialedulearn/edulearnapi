import { Injectable, NotFoundException } from '@nestjs/common';
import db from '../../drizzle';
import { quizGenerationSchedule } from '../../lib/db/schema';
import { eq } from 'drizzle-orm';
import { UpsertQuizScheduleDto } from './dto/upsert-quiz-schedule.dto';
import { QuizScheduleBullmqService } from './quiz-schedule-bullmq.service';
import {
  QUIZ_SCHEDULE_JOB_NAME,
  quizScheduleSchedulerId,
} from './quiz-schedule.constants';

@Injectable()
export class QuizScheduleService {
  constructor(private readonly bullmq: QuizScheduleBullmqService) {}

  async getForUser(userId: string) {
    const [row] = await db
      .select()
      .from(quizGenerationSchedule)
      .where(eq(quizGenerationSchedule.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async upsertForUser(userId: string, dto: UpsertQuizScheduleDto) {
    const timeZone = dto.timeZone?.trim() || 'UTC';
    const existing = await this.getForUser(userId);
    if (existing) {
      await db
        .update(quizGenerationSchedule)
        .set({
          topic: dto.topic.trim(),
          difficulty: dto.difficulty,
          cronExpression: dto.cronExpression.trim(),
          timeZone,
          enabled: true,
          updatedAt: new Date(),
        })
        .where(eq(quizGenerationSchedule.userId, userId));
    } else {
      await db.insert(quizGenerationSchedule).values({
        userId,
        topic: dto.topic.trim(),
        difficulty: dto.difficulty,
        cronExpression: dto.cronExpression.trim(),
        timeZone,
        enabled: true,
      });
    }
    const queue = this.bullmq.getQueue();
    const schedulerId = quizScheduleSchedulerId(userId);
    await queue.upsertJobScheduler(
      schedulerId,
      {
        pattern: dto.cronExpression.trim(),
        tz: timeZone,
      },
      {
        name: QUIZ_SCHEDULE_JOB_NAME,
        data: { userId },
        opts: { attempts: 1 },
      },
    );
    return this.getForUser(userId);
  }

  async deleteForUser(userId: string) {
    const row = await this.getForUser(userId);
    if (!row) {
      throw new NotFoundException('No quiz schedule found');
    }
    const queue = this.bullmq.getQueue();
    await queue.removeJobScheduler(quizScheduleSchedulerId(userId));
    await db
      .delete(quizGenerationSchedule)
      .where(eq(quizGenerationSchedule.userId, userId));
  }
}
