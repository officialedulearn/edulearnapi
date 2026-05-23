import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AgentWakeupBullmqService } from './agent-wakeup-bullmq.service';
import { AGENT_WAKEUP_QUEUE_NAME } from './agent-wakeup.constants';
import type { AgentWakeupEvaluateJobData } from './agent-wakeup.types';
import { AgentWakeupService } from './agent-wakeup.service';
import { QueueHealthService } from 'src/observability/queue-health.service';
import {
  captureJobFailure,
  captureWorkerError,
  startSentrySpan,
} from 'src/observability/sentry';

@Injectable()
export class AgentWakeupProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentWakeupProcessorService.name);
  private worker: Worker<AgentWakeupEvaluateJobData> | null = null;
  private workerConnection: Redis | null = null;

  constructor(
    private readonly bullmq: AgentWakeupBullmqService,
    private readonly agentWakeupService: AgentWakeupService,
    private readonly queueHealth: QueueHealthService,
  ) {}

  onModuleInit() {
    this.queueHealth.register(AGENT_WAKEUP_QUEUE_NAME);
    this.workerConnection = this.bullmq.duplicateConnection();
    this.worker = new Worker<AgentWakeupEvaluateJobData>(
      AGENT_WAKEUP_QUEUE_NAME,
      async (job: Job<AgentWakeupEvaluateJobData>) => this.processJob(job),
      { connection: this.workerConnection, concurrency: 2 },
    );
    this.worker.on('ready', () => {
      this.queueHealth.markReady(AGENT_WAKEUP_QUEUE_NAME);
      this.logger.log(`Agent wake-up worker ready queue=${AGENT_WAKEUP_QUEUE_NAME}`);
    });
    this.worker.on('error', (err: Error) => {
      this.queueHealth.markError(AGENT_WAKEUP_QUEUE_NAME, err);
      captureWorkerError(AGENT_WAKEUP_QUEUE_NAME, err);
      this.logger.error(`Agent wake-up worker error: ${err.message}`, err.stack);
    });
    this.worker.on('failed', (job, err) => {
      this.queueHealth.markFailure(AGENT_WAKEUP_QUEUE_NAME, job?.id, err);
      captureJobFailure(AGENT_WAKEUP_QUEUE_NAME, job, err);
      this.logger.error(
        `Agent wake-up job ${job?.id} failed: ${err?.message}`,
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

  private async processJob(job: Job<AgentWakeupEvaluateJobData>) {
    await startSentrySpan(
      {
        name: 'Process agent wake-up job',
        op: 'bullmq.agent_wakeup.process',
        attributes: {
          queue: AGENT_WAKEUP_QUEUE_NAME,
          jobId: job.id,
          jobName: job.name,
          attemptsMade: job.attemptsMade,
        },
      },
      async () => {
        const userId = job.data?.userId;
        const reason = job.data?.reason || 'scheduled';
        if (!userId) {
          this.logger.warn('Agent wake-up job missing userId');
          return;
        }

        this.logger.log(
          `Evaluating agent wake-up jobId=${job.id} userId=${userId} reason=${reason}`,
        );
        await this.agentWakeupService.evaluateUser({ userId, reason });
      },
    );
  }
}
