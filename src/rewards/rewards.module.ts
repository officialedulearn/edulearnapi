import { Module, forwardRef } from '@nestjs/common';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';
import { ResendModule } from 'src/resend/resend.module';
import { TwitterModule } from 'src/twitter/twitter.module';
import { AuthModule } from 'src/auth/auth.module';
import { SocialModule } from 'src/social/social.module';

@Module({
  imports: [
    ResendModule, 
    TwitterModule,
    forwardRef(() => AuthModule),
    forwardRef(() => SocialModule),
  ],
  controllers: [RewardsController],
  providers: [RewardsService],
  exports: [RewardsService]
})
export class RewardsModule {}