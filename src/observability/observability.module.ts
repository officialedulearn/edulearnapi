import { Global, Module } from '@nestjs/common';
import { QueueHealthService } from './queue-health.service';

@Global()
@Module({
  providers: [QueueHealthService],
  exports: [QueueHealthService],
})
export class ObservabilityModule {}
