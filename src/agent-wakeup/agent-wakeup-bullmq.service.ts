import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { AGENT_WAKEUP_QUEUE_NAME } from './agent-wakeup.constants';
import type { AgentWakeupEvaluateJobData } from './agent-wakeup.types';

@Injectable()
export class AgentWakeupBullmqService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentWakeupBullmqService.name);
  private connection: Redis | null = null;
  private queue: Queue<AgentWakeupEvaluateJobData> | null = null;

  private maskRedisUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.password) u.password = '****';
      return u.toString();
    } catch {
      return '(invalid REDIS_URL)';
    }
  }

  getQueue(): Queue<AgentWakeupEvaluateJobData> {
    if (!this.queue) {
      const url = process.env.REDIS_URL || 'redis://localhost:6379';
      this.logger.log(
        `Agent wake-up queue connecting ${this.maskRedisUrl(url)}`,
      );
      this.connection = new Redis(url, { maxRetriesPerRequest: null });
      this.connection.on('error', (err) =>
        this.logger.error(`Agent wake-up Redis: ${err.message}`),
      );
      this.queue = new Queue<AgentWakeupEvaluateJobData>(
        AGENT_WAKEUP_QUEUE_NAME,
        { connection: this.connection },
      );
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
