import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getDatabaseUserId } from '../common/helpers/authorization.helper';
import {
  ReferralLeaderboardResponse,
  ReferralOverviewResponse,
} from './referral.types';
import { ReferralService } from './referral.service';

@Throttle({ default: { limit: 40, ttl: 60_000 } })
@Controller('referral')
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Get('leaderboard')
  getReferralLeaderboard(): Promise<ReferralLeaderboardResponse> {
    return this.referralService.getReferralLeaderboard();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMyReferralOverview(
    @Request() req,
  ): Promise<ReferralOverviewResponse> {
    const userId = await getDatabaseUserId(req.user);
    return this.referralService.getReferralOverview(userId);
  }
}
