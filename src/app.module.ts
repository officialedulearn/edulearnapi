import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { ChatModule } from './chat/chat.module';
import { RewardsModule } from './rewards/rewards.module';
import { ActivityModule } from './activity/activity.module';
import { ConfigModule } from '@nestjs/config';
import { WalletController } from './wallet/wallet.controller';
import { WalletModule } from './wallet/wallet.module';
import { CronTasksModule } from './cron-tasks/cron-tasks.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TwitterModule } from './twitter/twitter.module';
import { RoadmapModule } from './roadmap/roadmap.module';

@Module({
  imports: [
    AuthModule,
    AiModule,
    ChatModule,
    RewardsModule,
    ActivityModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    WalletModule,
    CronTasksModule,
    TwitterModule,
    RoadmapModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}