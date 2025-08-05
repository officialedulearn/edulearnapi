import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ActivityModule } from 'src/activity/activity.module';
import { WalletModule } from 'src/wallet/wallet.module';
import { RewardsModule } from 'src/rewards/rewards.module';

@Module({
  imports: [ActivityModule, WalletModule, RewardsModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
