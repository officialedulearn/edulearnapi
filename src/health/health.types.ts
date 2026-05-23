export type HealthStatus = 'ok' | 'ready' | 'degraded' | 'unready';

export interface DependencyHealth {
  name: string;
  status: 'ok' | 'missing' | 'error' | 'unknown';
  message?: string;
}

export interface HealthResponse {
  status: HealthStatus;
  service: string;
  timestamp: string;
  uptimeSeconds: number;
}

export interface ReadinessResponse extends HealthResponse {
  dependencies: DependencyHealth[];
}

export interface DependencyHealthResponse extends ReadinessResponse {
  queues: Array<{
    queueName: string;
    status: string;
    lastReadyAt?: string;
    lastErrorAt?: string;
    lastFailureAt?: string;
    lastErrorMessage?: string;
    lastJobId?: string;
  }>;
}
