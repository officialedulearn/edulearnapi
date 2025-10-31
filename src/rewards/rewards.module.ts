import { Module } from '@nestjs/common';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
import { ResendModule } from 'src/resend/resend.module';
import {TwitterModule} from 'src/twitter/twitter.module'

@Module({
  imports: [ResendModule, TwitterModule],
  controllers: [RewardsController],
  providers: [RewardsService],
  exports: [RewardsService]
})
export class RewardsModule {}