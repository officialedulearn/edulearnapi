import { Injectable } from '@nestjs/common';

export type QueueHealthStatus = 'unknown' | 'ready' | 'error' | 'failed';

export interface QueueHealthSnapshot {
  queueName: string;
  status: QueueHealthStatus;
  lastReadyAt?: string;
  lastErrorAt?: string;
  lastFailureAt?: string;
  lastErrorMessage?: string;
  lastJobId?: string;
}

@Injectable()
export class QueueHealthService {
  private readonly queues = new Map<string, QueueHealthSnapshot>();

  register(queueName: string): void {
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, {
        queueName,
        status: 'unknown',
      });
    }
  }

  markReady(queueName: string): void {
    const current = this.getOrCreate(queueName);
    this.queues.set(queueName, {
      ...current,
      status: 'ready',
      lastReadyAt: new Date().toISOString(),
    });
  }

  markError(queueName: string, error: Error): void {
    const current = this.getOrCreate(queueName);
    this.queues.set(queueName, {
      ...current,
      status: 'error',
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: error.message,
    });
  }

  markFailure(queueName: string, jobId: string | undefined, error: Error): void {
    const current = this.getOrCreate(queueName);
    this.queues.set(queueName, {
      ...current,
      status: current.status === 'ready' ? 'ready' : 'failed',
      lastFailureAt: new Date().toISOString(),
      lastErrorMessage: error.message,
      lastJobId: jobId,
    });
  }

  getSnapshots(): QueueHealthSnapshot[] {
    return Array.from(this.queues.values()).sort((a, b) =>
      a.queueName.localeCompare(b.queueName),
    );
  }

  private getOrCreate(queueName: string): QueueHealthSnapshot {
    this.register(queueName);
    return this.queues.get(queueName)!;
  }
}
