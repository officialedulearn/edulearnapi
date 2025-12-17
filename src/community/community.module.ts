import { Module, forwardRef } from '@nestjs/common';
import { CommunityService } from './community.service';
import { CommunityController } from './community.controller';
import { CommunityGateway } from './community.gateway';
import { RedisModule } from '../redis/redis.module';
import { CommonModule } from '../common/common.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    RedisModule,
    CommonModule,
    forwardRef(() => AuthModule),
    
  ],
  controllers: [CommunityController],
  providers: [CommunityService, CommunityGateway],
  exports: [CommunityService],
})
export class CommunityModule {}
