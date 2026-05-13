import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  ROADMAP_STEP_START_JOB_NAME,
  ROADMAP_STEP_START_QUEUE_NAME,
  roadmapStepStartJobId,
} from './roadmap-step-start.constants';
import type { RoadmapStepStartJobData } from './roadmap-step-start.types';

@Injectable()
export class RoadmapStepStartBullmqService implements OnModuleDestroy {
  private readonly logger = new Logger(RoadmapStepStartBullmqService.name);
  private connection: Redis | null = null;
  private queue: Queue<RoadmapStepStartJobData> | null = null;

  getQueue(): Queue<RoadmapStepStartJobData> {
    if (!this.queue) {
      const url = process.env.REDIS_URL || 'redis://localhost:6379';
      this.connection = new Redis(url, { maxRetriesPerRequest: null });
      this.connection.on('error', (err) =>
        this.logger.error(`Roadmap step Redis: ${err.message}`),
      );
      this.queue = new Queue<RoadmapStepStartJobData>(
        ROADMAP_STEP_START_QUEUE_NAME,
        {
          connection: this.connection,
        },
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

  async enqueueStepStart(
    data: RoadmapStepStartJobData,
  ): Promise<{ job: Job<RoadmapStepStartJobData>; enqueued: boolean }> {
    const queue = this.getQueue();
    const jobId = roadmapStepStartJobId(data.userId, data.stepId);
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      return { job: existingJob, enqueued: false };
    }

    const job = await queue.add(ROADMAP_STEP_START_JOB_NAME, data, {
      jobId,
      attempts: 1,
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 1000 },
    });

    return { job, enqueued: true };
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
