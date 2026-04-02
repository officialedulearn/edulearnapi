import { Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { RewardsModule } from '../rewards/rewards.module';
import { RoadmapModule } from '../roadmap/roadmap.module';

@Module({
  imports: [RewardsModule, RoadmapModule],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
