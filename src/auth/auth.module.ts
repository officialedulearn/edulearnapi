import { forwardRef, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ActivityModule } from 'src/activity/activity.module';
import { WalletModule } from 'src/wallet/wallet.module';
import { RewardsModule } from 'src/rewards/rewards.module';
import { CronTasksModule } from 'src/cron-tasks/cron-tasks.module';
import { ResendModule } from 'src/resend/resend.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiKeyGuard } from './guards/api-key.guard';
import { RoadmapModule } from 'src/roadmap/roadmap.module';
import { CommunityModule } from 'src/community/community.module';
import { SocialModule } from 'src/social/social.module';
import { LeaderboardModule } from 'src/leaderboard/leaderboard.module';
import { CloudinaryModule } from 'src/common/cloudinary/cloudinary.module';

@Module({
  imports: [
    CloudinaryModule,
    ActivityModule,
    forwardRef(() => WalletModule),
    RewardsModule,
    forwardRef(() => CronTasksModule),
    ResendModule,
    forwardRef(() => RoadmapModule),
    forwardRef(() => CommunityModule),
    forwardRef(() => SocialModule),
    LeaderboardModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, ApiKeyGuard],
  exports: [AuthService, JwtAuthGuard, ApiKeyGuard],
})
export class AuthModule {}
