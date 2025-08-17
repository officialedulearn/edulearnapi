import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ChatModule } from 'src/chat/chat.module';
import { AuthModule } from 'src/auth/auth.module';
import { ActivityModule } from 'src/activity/activity.module';
import { RewardsModule } from 'src/rewards/rewards.module';

@Module({
  imports: [ChatModule, AuthModule, ActivityModule, RewardsModule],
  controllers: [AiController],
  providers: [AiService]
})
export class AiModule {}
