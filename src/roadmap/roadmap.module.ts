import { Module, forwardRef } from '@nestjs/common';
import { RoadmapController } from './roadmap.controller';
import { RoadmapService } from './roadmap.service';
import { AuthModule } from 'src/auth/auth.module';
import { ChatModule } from 'src/chat/chat.module';
import { AiModule } from 'src/ai/ai.module';
import { RewardsModule } from 'src/rewards/rewards.module';

@Module({
  imports: [AuthModule, ChatModule, forwardRef(() => AiModule), RewardsModule],
  controllers: [RoadmapController],
  providers: [RoadmapService],
  exports: [RoadmapService]
})
export class RoadmapModule {}
