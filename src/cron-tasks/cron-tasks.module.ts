import { forwardRef, Module } from '@nestjs/common';
import { CronTasksService } from './cron-tasks.service';
import { CronTasksController } from './cron-tasks.controller';
import { AuthModule } from 'src/auth/auth.module';
import { WalletModule } from 'src/wallet/wallet.module';
import { TwitterModule } from 'src/twitter/twitter.module';
import { ExpoPushService } from 'src/common/services/expo-push.service';
import { CardsModule } from 'src/cards/cards.module';
import { LeaderboardModule } from 'src/leaderboard/leaderboard.module';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => WalletModule),
    TwitterModule,
    CardsModule,
    LeaderboardModule,
  ],
  providers: [CronTasksService, ExpoPushService],
  controllers: [CronTasksController],
  exports: [CronTasksService]
})
export class CronTasksModule {}