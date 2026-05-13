import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { RoadmapStepStartBullmqService } from './roadmap-step-start-bullmq.service';
import { ROADMAP_STEP_START_QUEUE_NAME } from './roadmap-step-start.constants';
import type { RoadmapStepStartJobData } from './roadmap-step-start.types';
import { RoadmapService } from './roadmap.service';

@Injectable()
export class RoadmapStepStartProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(RoadmapStepStartProcessorService.name);
  private worker: Worker<RoadmapStepStartJobData> | null = null;
  private workerConnection: Redis | null = null;

  constructor(
    private readonly bullmq: RoadmapStepStartBullmqService,
    private readonly roadmapService: RoadmapService,
  ) {}

  onModuleInit() {
    this.workerConnection = this.bullmq.duplicateConnection();
    this.worker = new Worker<RoadmapStepStartJobData>(
      ROADMAP_STEP_START_QUEUE_NAME,
      async (job: Job<RoadmapStepStartJobData>) => this.processJob(job),
      { connection: this.workerConnection, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `Roadmap step job ${job?.id} failed: ${err?.message}`,
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

  private async processJob(job: Job<RoadmapStepStartJobData>) {
    const { userId, stepId } = job.data ?? {};
    if (!userId || !stepId) {
      this.logger.warn('Roadmap step job missing userId or stepId');
      return;
    }

    this.logger.log(`Generating roadmap step ${stepId} for user ${userId}`);
    await this.roadmapService.processRoadmapStepStartJob(job.data);
  }
}
