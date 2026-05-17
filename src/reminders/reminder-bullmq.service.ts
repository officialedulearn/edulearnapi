import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REMINDER_QUEUE_NAME } from './reminders.constants';
import type { ReminderEvaluateJobData } from './reminders.types';

@Injectable()
export class ReminderBullmqService implements OnModuleDestroy {
  private readonly logger = new Logger(ReminderBullmqService.name);
  private connection: Redis | null = null;
  private queue: Queue<ReminderEvaluateJobData> | null = null;

  private maskRedisUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.password) u.password = '****';
      return u.toString();
    } catch {
      return '(invalid REDIS_URL)';
    }
  }

  getQueue(): Queue<ReminderEvaluateJobData> {
    if (!this.queue) {
      const url = process.env.REDIS_URL || 'redis://localhost:6379';
      this.logger.log(`Reminder queue connecting ${this.maskRedisUrl(url)}`);
      this.connection = new Redis(url, { maxRetriesPerRequest: null });
      this.connection.on('error', (err) =>
        this.logger.error(`Reminder Redis: ${err.message}`),
      );
      this.queue = new Queue<ReminderEvaluateJobData>(REMINDER_QUEUE_NAME, {
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

