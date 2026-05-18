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

@Injectable()
export class AgentWakeupProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentWakeupProcessorService.name);
  private worker: Worker<AgentWakeupEvaluateJobData> | null = null;
  private workerConnection: Redis | null = null;

  constructor(
    private readonly bullmq: AgentWakeupBullmqService,
    private readonly agentWakeupService: AgentWakeupService,
  ) {}

  onModuleInit() {
    this.workerConnection = this.bullmq.duplicateConnection();
    this.worker = new Worker<AgentWakeupEvaluateJobData>(
      AGENT_WAKEUP_QUEUE_NAME,
      async (job: Job<AgentWakeupEvaluateJobData>) => this.processJob(job),
      { connection: this.workerConnection, concurrency: 2 },
    );
    this.worker.on('failed', (job, err) => {
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
  }
}
