import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import Redis from 'ioredis';
import { ReminderBullmqService } from './reminder-bullmq.service';
import {
  REMINDER_EVALUATE_JOB_NAME,
  REMINDER_QUEUE_NAME,
} from './reminders.constants';
import type { ReminderEvaluateJobData } from './reminders.types';
import { RemindersService } from './reminders.service';
import { QueueHealthService } from 'src/observability/queue-health.service';
import {
  captureJobFailure,
  captureWorkerError,
  startSentrySpan,
} from 'src/observability/sentry';

@Injectable()
export class ReminderProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderProcessorService.name);
  private worker: Worker<ReminderEvaluateJobData> | null = null;
  private workerConnection: Redis | null = null;

  constructor(
    private readonly bullmq: ReminderBullmqService,
    private readonly remindersService: RemindersService,
    private readonly queueHealth: QueueHealthService,
  ) {}

  onModuleInit() {
    this.queueHealth.register(REMINDER_QUEUE_NAME);
    this.workerConnection = this.bullmq.duplicateConnection();
    this.worker = new Worker<ReminderEvaluateJobData>(
      REMINDER_QUEUE_NAME,
      async (job: Job<ReminderEvaluateJobData>) => this.processJob(job),
      { connection: this.workerConnection, concurrency: 2 },
    );
    this.worker.on('ready', () => {
      this.queueHealth.markReady(REMINDER_QUEUE_NAME);
      this.logger.log(
        `Reminder worker ready queue=${REMINDER_QUEUE_NAME} concurrency=2`,
      );
    });
    this.worker.on('error', (err: Error) => {
      this.queueHealth.markError(REMINDER_QUEUE_NAME, err);
      captureWorkerError(REMINDER_QUEUE_NAME, err);
      this.logger.error(`Reminder worker error: ${err.message}`, err.stack);
    });
    this.worker.on('failed', (job, err) => {
      this.queueHealth.markFailure(REMINDER_QUEUE_NAME, job?.id, err);
      captureJobFailure(REMINDER_QUEUE_NAME, job, err);
      this.logger.error(
        `Reminder job ${job?.id} failed: ${err?.message}`,
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

  private async processJob(job: Job<ReminderEvaluateJobData>) {
    await startSentrySpan(
      {
        name: 'Process reminder job',
        op: 'bullmq.reminders.process',
        attributes: {
          queue: REMINDER_QUEUE_NAME,
          jobId: job.id,
          jobName: job.name || REMINDER_EVALUATE_JOB_NAME,
          attemptsMade: job.attemptsMade,
        },
      },
      async () => {
        const userId = job.data?.userId;
        const reason = job.data?.reason || 'scheduled';
        if (!userId) {
          this.logger.warn('Reminder job missing userId');
          return;
        }
        this.logger.log(
          `Evaluating reminders jobId=${job.id} userId=${userId} reason=${reason}`,
        );
        await this.remindersService.evaluateUser({ userId, reason });
      },
    );
  }
}
