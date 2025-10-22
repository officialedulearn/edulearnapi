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

@Module({
  imports: [ActivityModule, forwardRef(() => WalletModule), RewardsModule, forwardRef(() => CronTasksModule), ResendModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, ApiKeyGuard],
  exports: [AuthService, JwtAuthGuard, ApiKeyGuard],
})
export class AuthModule {}