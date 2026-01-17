import { Module, forwardRef } from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { RewardsModule } from '../rewards/rewards.module';

@Module({
  imports: [forwardRef(() => RewardsModule)],
  providers: [SubscriptionService],
  controllers: [SubscriptionController],
  exports: [SubscriptionService]
})
export class SubscriptionModule {}
