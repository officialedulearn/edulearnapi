import { Module, forwardRef } from '@nestjs/common';
import { RoadmapController } from './roadmap.controller';
import { RoadmapService } from './roadmap.service';
import { AuthModule } from 'src/auth/auth.module';
import { ChatModule } from 'src/chat/chat.module';
import { AiModule } from 'src/ai/ai.module';
import { RewardsModule } from 'src/rewards/rewards.module';
import { RemindersModule } from 'src/reminders/reminders.module';
import { RedisModule } from 'src/redis/redis.module';
import { RoadmapStepStartBullmqService } from './roadmap-step-start-bullmq.service';
import { RoadmapStepStartProcessorService } from './roadmap-step-start-processor.service';
import { RoadmapSubStepBackfillService } from './roadmap-sub-step-backfill.service';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    ChatModule,
    forwardRef(() => AiModule),
    RewardsModule,
    RemindersModule,
    RedisModule,
  ],
  controllers: [RoadmapController],
  providers: [
    RoadmapService,
    RoadmapStepStartBullmqService,
    RoadmapStepStartProcessorService,
    RoadmapSubStepBackfillService,
  ],
  exports: [RoadmapService],
})
export class RoadmapModule {}
