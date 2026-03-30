import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { ChatModule } from './chat/chat.module';
import { RewardsModule } from './rewards/rewards.module';
import { ActivityModule } from './activity/activity.module';
import { ConfigModule } from '@nestjs/config';
import { WalletModule } from './wallet/wallet.module';
import { CronTasksModule } from './cron-tasks/cron-tasks.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TwitterModule } from './twitter/twitter.module';
import { RoadmapModule } from './roadmap/roadmap.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { ResendModule } from './resend/resend.module';
import { CommonModule } from './common/common.module';
import { CommunityModule } from './community/community.module';
import { RedisService } from './redis/redis.service';
import { RedisModule } from './redis/redis.module';
import { CardsModule } from './cards/cards.module';
import { AdminModule } from './admin/admin.module';
import { FeedbackModule } from './feedback/feedback.module';
import { SocialModule } from './social/social.module';
import { NotificationsModule } from './notifications/notifications.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { EmailPreviewModule } from './emails/email-preview.module';
import { MonthlyLeaderboardModule } from './monthly-leaderboard/monthly-leaderboard.module';
import { TrendsModule } from './trends/trends.module';

@Module({
  imports: [
    CommonModule,
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
    SubscriptionModule,
    ResendModule,
    CommunityModule,
    RedisModule,
    CardsModule,
    AdminModule,
    FeedbackModule,
    SocialModule,
    NotificationsModule,
    QuizzesModule,
    EmailPreviewModule,
    MonthlyLeaderboardModule,
    TrendsModule,
  ],
  controllers: [AppController],
  providers: [AppService, RedisService],
})
export class AppModule {}