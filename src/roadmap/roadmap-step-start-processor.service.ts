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
import { QueueHealthService } from 'src/observability/queue-health.service';
import {
  captureJobFailure,
  captureWorkerError,
  startSentrySpan,
} from 'src/observability/sentry';

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
    private readonly queueHealth: QueueHealthService,
  ) {}

  onModuleInit() {
    this.queueHealth.register(ROADMAP_STEP_START_QUEUE_NAME);
    this.workerConnection = this.bullmq.duplicateConnection();
    this.worker = new Worker<RoadmapStepStartJobData>(
      ROADMAP_STEP_START_QUEUE_NAME,
      async (job: Job<RoadmapStepStartJobData>) => this.processJob(job),
      { connection: this.workerConnection, concurrency: 2 },
    );
    this.worker.on('ready', () => {
      this.queueHealth.markReady(ROADMAP_STEP_START_QUEUE_NAME);
      this.logger.log(
        `Roadmap step worker ready queue=${ROADMAP_STEP_START_QUEUE_NAME}`,
      );
    });
    this.worker.on('error', (err: Error) => {
      this.queueHealth.markError(ROADMAP_STEP_START_QUEUE_NAME, err);
      captureWorkerError(ROADMAP_STEP_START_QUEUE_NAME, err);
      this.logger.error(`Roadmap step worker error: ${err.message}`, err.stack);
    });
    this.worker.on('failed', (job, err) => {
      this.queueHealth.markFailure(ROADMAP_STEP_START_QUEUE_NAME, job?.id, err);
      captureJobFailure(ROADMAP_STEP_START_QUEUE_NAME, job, err);
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
    await startSentrySpan(
      {
        name: 'Process roadmap step job',
        op: 'bullmq.roadmap_step.process',
        attributes: {
          queue: ROADMAP_STEP_START_QUEUE_NAME,
          jobId: job.id,
          jobName: job.name,
          attemptsMade: job.attemptsMade,
        },
      },
      async () => {
        const { userId, stepId } = job.data ?? {};
        if (!userId || !stepId) {
          this.logger.warn('Roadmap step job missing userId or stepId');
          return;
        }

        this.logger.log(`Generating roadmap step ${stepId} for user ${userId}`);
        await this.roadmapService.processRoadmapStepStartJob(job.data);
      },
    );
  }
}
