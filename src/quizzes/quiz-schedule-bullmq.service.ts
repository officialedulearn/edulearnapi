import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { QUIZ_SCHEDULE_QUEUE_NAME } from './quiz-schedule.constants';
import type { QuizScheduleJobData } from './quiz-schedule.types';

@Injectable()
export class QuizScheduleBullmqService implements OnModuleDestroy {
  private readonly logger = new Logger(QuizScheduleBullmqService.name);
  private connection: Redis | null = null;
  private queue: Queue<QuizScheduleJobData> | null = null;

  getQueue(): Queue<QuizScheduleJobData> {
    if (!this.queue) {
      const url = process.env.REDIS_URL || 'redis://localhost:6379';
      this.connection = new Redis(url, {
        maxRetriesPerRequest: null,
      });
      this.connection.on('error', (err) =>
        this.logger.error(`Quiz schedule Redis: ${err.message}`),
      );
      this.queue = new Queue<QuizScheduleJobData>(QUIZ_SCHEDULE_QUEUE_NAME, {
        connection: this.connection,
      });
    }
    return this.queue;
  }

  duplicateConnection(): Redis {
    if (!this.connection) {
      this.getQueue();
    }
    return this.connection!.duplicate();
  }

  async onModuleDestroy() {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
    }
  }
}
