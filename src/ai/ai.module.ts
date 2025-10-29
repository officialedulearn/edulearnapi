import { Module, forwardRef } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ChatModule } from 'src/chat/chat.module';
import { AuthModule } from 'src/auth/auth.module';
import { RewardsModule } from 'src/rewards/rewards.module';
import { RoadmapModule } from 'src/roadmap/roadmap.module';

@Module({
  imports: [ChatModule, forwardRef(() => AuthModule), RewardsModule, forwardRef(() => RoadmapModule)],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService]
})
export class AiModule {}
