import { Module } from '@nestjs/common';
import { MonthlyLeaderboardService } from './monthly-leaderboard.service';
import { MonthlyLeaderboardController } from './monthly-leaderboard.controller';
import { CardsModule } from 'src/cards/cards.module';
import { LeaderboardModule } from 'src/leaderboard/leaderboard.module';
import { TwitterModule } from 'src/twitter/twitter.module';

@Module({
  imports: [CardsModule, LeaderboardModule, TwitterModule],
  controllers: [MonthlyLeaderboardController],
  providers: [MonthlyLeaderboardService],
  exports: [MonthlyLeaderboardService],
})
export class MonthlyLeaderboardModule {}
