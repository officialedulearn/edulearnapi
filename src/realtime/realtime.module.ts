import { Module, forwardRef } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { CommunityModule } from '../community/community.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisherService } from './realtime.publisher';

@Module({
  imports: [RedisModule, forwardRef(() => CommunityModule)],
  providers: [RealtimeGateway, RealtimePublisherService],
  exports: [RealtimePublisherService],
})
export class RealtimeModule {}
