import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import type {
  DependencyHealthResponse,
  HealthResponse,
  ReadinessResponse,
} from './health.types';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }

  @Get('ready')
  getReadiness(): Promise<ReadinessResponse> {
    return this.healthService.getReadiness();
  }

  @Get('dependencies')
  getDependencies(): Promise<DependencyHealthResponse> {
    return this.healthService.getDependencies();
  }
}
