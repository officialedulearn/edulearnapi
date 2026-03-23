import { Module, forwardRef } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { RewardsModule } from '../rewards/rewards.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    forwardRef(() => RewardsModule),
    forwardRef(() => WalletModule),
  ],
  providers: [SubscriptionService],
  controllers: [SubscriptionController],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
