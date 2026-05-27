import { Injectable } from '@nestjs/common';
import { QueueHealthService } from 'src/observability/queue-health.service';
import { RedisService } from 'src/redis/redis.service';
import type {
  DependencyHealth,
  DependencyHealthResponse,
  HealthResponse,
  HealthStatus,
  ReadinessResponse,
} from './health.types';

@Injectable()
export class HealthService {
  constructor(
    private readonly redisService: RedisService,
    private readonly queueHealth: QueueHealthService,
  ) {}

  getHealth(): HealthResponse {
    return this.baseResponse('ok');
  }

  async getReadiness(): Promise<ReadinessResponse> {
    const dependencies = await this.getEssentialDependencies();
    const status = dependencies.some((dep) => dep.status === 'error')
      ? 'unready'
      : 'ready';

    return {
      ...this.baseResponse(status),
      dependencies,
    };
  }

  async getDependencies(): Promise<DependencyHealthResponse> {
    const readiness = await this.getReadiness();
    return {
      ...readiness,
      status: this.getDependencyStatus(readiness.dependencies),
      queues: this.queueHealth.getSnapshots(),
    };
  }

  private baseResponse(status: HealthStatus): HealthResponse {
    return {
      status,
      service: 'edulearn-api',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  private async getEssentialDependencies(): Promise<DependencyHealth[]> {
    return [
      await this.getRedisHealth(),
      this.getEnvHealth('GEMINI_API_KEY', 'gemini'),
      this.getEnvHealth('RESEND_API_KEY', 'resend'),
      this.getCloudinaryHealth(),
    ];
  }

  private async getRedisHealth(): Promise<DependencyHealth> {
    try {
      const result = await this.redisService.ping();
      return {
        name: 'redis',
        status: result === 'PONG' ? 'ok' : 'unknown',
        message: result,
      };
    } catch (error) {
      return {
        name: 'redis',
        status: 'error',
        message: error instanceof Error ? error.message : 'Redis ping failed',
      };
    }
  }

  private getEnvHealth(
    envName: string,
    dependencyName: string,
  ): DependencyHealth {
    return process.env[envName]?.trim()
      ? { name: dependencyName, status: 'ok' }
      : {
          name: dependencyName,
          status: 'missing',
          message: `${envName} is not configured`,
        };
  }

  private getCloudinaryHealth(): DependencyHealth {
    const missing = [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ].filter((envName) => !process.env[envName]?.trim());

    return missing.length === 0
      ? { name: 'cloudinary', status: 'ok' }
      : {
          name: 'cloudinary',
          status: 'missing',
          message: `${missing.join(', ')} not configured`,
        };
  }

  private getDependencyStatus(dependencies: DependencyHealth[]): HealthStatus {
    if (dependencies.some((dep) => dep.status === 'error')) {
      return 'unready';
    }
    if (dependencies.some((dep) => dep.status === 'missing')) {
      return 'degraded';
    }
    return 'ready';
  }
}
