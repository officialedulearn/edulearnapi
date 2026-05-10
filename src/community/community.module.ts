import { Module, forwardRef } from '@nestjs/common';
import { CommunityService } from './community.service';
import { CommunityController } from './community.controller';
import { RedisModule } from '../redis/redis.module';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    RedisModule,
    CommonModule,
    forwardRef(() => AuthModule),
    forwardRef(() => RealtimeModule),
  ],
  controllers: [CommunityController],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
