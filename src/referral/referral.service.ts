import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { user } from 'lib/db/schema';
import db from '../../drizzle';
import {
  ReferralCallToAction,
  ReferralLeaderboardEntry,
  ReferralLeaderboardRankedRow,
  ReferralLeaderboardResponse,
  ReferralMe,
  ReferralMilestone,
  ReferralOverviewResponse,
  ReferralUserStatsResponse,
} from './referral.types';

@Injectable()
export class ReferralService {
  private readonly leaderboardLimit = 5;
  private readonly referralMilestones = [
    { target: 1, label: 'Get on the board' },
    { target: 3, label: 'Build your first squad' },
    { target: 5, label: 'Break into the top 5' },
    { target: 10, label: 'Become a super connector' },
    { target: 25, label: 'Own the community wave' },
    { target: 50, label: 'Reach referral powerhouse status' },
    { target: 100, label: 'Unlock legend status' },
  ] as const;

  async getReferralCount(userId: string): Promise<number> {
    const stats = await this.getUserReferralStats(userId);
    return stats.total_referrals;
  }

  async getTotalEarnings(userId: string): Promise<number> {
    const stats = await this.getUserReferralStats(userId);
    return stats.total_earnings;
  }

  async totalEarnings(userId: string): Promise<number> {
    return this.getTotalEarnings(userId);
  }

  async getUserReferralStats(
    userId: string,
  ): Promise<ReferralUserStatsResponse> {
    const rankedUser = await this.getRankedUserById(userId);

    if (!rankedUser) {
      throw new NotFoundException('User not found');
    }

    return {
      user_id: rankedUser.userId,
      display_name: rankedUser.displayName,
      username: rankedUser.username,
      profile_picture_url: rankedUser.profilePictureUrl,
      referral_code: rankedUser.referralCode,
      total_referrals: rankedUser.totalReferrals,
      total_earnings: rankedUser.totalEarnings,
      level: rankedUser.level,
      streak: rankedUser.streak,
      xp: rankedUser.xp,
      quiz_completed: rankedUser.quizCompleted,
    };
  }

  async getReferralLeaderboard(
    currentUserId?: string,
  ): Promise<ReferralLeaderboardResponse> {
    const rankedUsers = this.getRankedUsersSubquery();
    const rows = await db
      .select({
        userId: rankedUsers.userId,
        displayName: rankedUsers.displayName,
        username: rankedUsers.username,
        profilePictureUrl: rankedUsers.profilePictureUrl,
        referralCode: rankedUsers.referralCode,
        totalReferrals: rankedUsers.totalReferrals,
        totalEarnings: rankedUsers.totalEarnings,
        level: rankedUsers.level,
        streak: rankedUsers.streak,
        xp: rankedUsers.xp,
        quizCompleted: rankedUsers.quizCompleted,
        rank: rankedUsers.rank,
      })
      .from(rankedUsers)
      .orderBy(asc(rankedUsers.rank))
      .limit(this.leaderboardLimit);

    const leaderboard = rows.map((row) =>
      this.toLeaderboardEntry(row, currentUserId),
    );
    const totalReferrals = leaderboard.reduce(
      (sum, entry) => sum + entry.total_referrals,
      0,
    );

    return {
      leaderboard,
      summary: {
        spots: this.leaderboardLimit,
        total_referrals: totalReferrals,
        average_referrals: leaderboard.length
          ? Number((totalReferrals / leaderboard.length).toFixed(1))
          : 0,
        cutoff_referrals: leaderboard.length
          ? leaderboard[leaderboard.length - 1].total_referrals
          : null,
        top_referrer_name: leaderboard[0]?.display_name ?? null,
      },
      updated_at: new Date().toISOString(),
    };
  }

  async getReferralOverview(userId: string): Promise<ReferralOverviewResponse> {
    const [leaderboardResponse, rankedUser] = await Promise.all([
      this.getReferralLeaderboard(userId),
      this.getRankedUserById(userId),
    ]);

    if (!rankedUser) {
      throw new NotFoundException('User not found');
    }

    const userAhead =
      rankedUser.rank <= this.leaderboardLimit
        ? leaderboardResponse.leaderboard.find(
            (entry) => entry.rank === rankedUser.rank - 1,
          )
        : await this.getRankedUserByRank(rankedUser.rank - 1);

    const me = this.toReferralMe(
      rankedUser,
      userAhead ?? null,
      leaderboardResponse.leaderboard,
    );

    return {
      ...leaderboardResponse,
      me,
      cta: this.buildCallToAction(me, leaderboardResponse.leaderboard),
    };
  }

  private getRankedUsersSubquery() {
    return db
      .select({
        userId: user.id,
        displayName: user.name,
        username: user.username,
        profilePictureUrl: user.profilePictureURL,
        referralCode: user.referralCode,
        totalReferrals: sql<number>`coalesce(${user.referralCount}, 0)`.mapWith(
          Number,
        ),
        totalEarnings:
          sql<number>`coalesce(${user.totalEarnings}, 0)::float8`.mapWith(
            Number,
          ),
        level: user.level,
        streak: sql<number>`coalesce(${user.streak}, 0)`.mapWith(Number),
        xp: sql<number>`coalesce(${user.xp}, 0)`.mapWith(Number),
        quizCompleted: sql<number>`coalesce(${user.quizCompleted}, 0)`.mapWith(
          Number,
        ),
        rank: sql<number>`row_number() over (
          order by
            coalesce(${user.referralCount}, 0) desc,
            coalesce(${user.xp}, 0) desc,
            coalesce(${user.streak}, 0) desc,
            ${user.name} asc
        )`.mapWith(Number),
      })
      .from(user)
      .as('ranked_referral_users');
  }

  private async getRankedUserById(
    userId: string,
  ): Promise<ReferralLeaderboardRankedRow | null> {
    const rankedUsers = this.getRankedUsersSubquery();
    const [row] = await db
      .select({
        userId: rankedUsers.userId,
        displayName: rankedUsers.displayName,
        username: rankedUsers.username,
        profilePictureUrl: rankedUsers.profilePictureUrl,
        referralCode: rankedUsers.referralCode,
        totalReferrals: rankedUsers.totalReferrals,
        totalEarnings: rankedUsers.totalEarnings,
        level: rankedUsers.level,
        streak: rankedUsers.streak,
        xp: rankedUsers.xp,
        quizCompleted: rankedUsers.quizCompleted,
        rank: rankedUsers.rank,
      })
      .from(rankedUsers)
      .where(eq(rankedUsers.userId, userId))
      .limit(1);

    return row ?? null;
  }

  private async getRankedUserByRank(
    rank: number,
  ): Promise<ReferralLeaderboardRankedRow | null> {
    if (rank < 1) {
      return null;
    }

    const rankedUsers = this.getRankedUsersSubquery();
    const offset = rank - 1;
    const [row] = await db
      .select({
        userId: rankedUsers.userId,
        displayName: rankedUsers.displayName,
        username: rankedUsers.username,
        profilePictureUrl: rankedUsers.profilePictureUrl,
        referralCode: rankedUsers.referralCode,
        totalReferrals: rankedUsers.totalReferrals,
        totalEarnings: rankedUsers.totalEarnings,
        level: rankedUsers.level,
        streak: rankedUsers.streak,
        xp: rankedUsers.xp,
        quizCompleted: rankedUsers.quizCompleted,
        rank: rankedUsers.rank,
      })
      .from(rankedUsers)
      .orderBy(asc(rankedUsers.rank))
      .offset(offset)
      .limit(1);

    return row ?? null;
  }

  private toLeaderboardEntry(
    row: ReferralLeaderboardRankedRow,
    currentUserId?: string,
  ): ReferralLeaderboardEntry {
    return {
      rank: row.rank,
      user_id: row.userId,
      display_name: row.displayName,
      username: row.username,
      profile_picture_url: row.profilePictureUrl,
      total_referrals: row.totalReferrals,
      total_earnings: row.totalEarnings,
      level: row.level,
      streak: row.streak,
      xp: row.xp,
      quiz_completed: row.quizCompleted,
      highlight: this.getHighlightLabel(row.rank, row.totalReferrals),
      is_current_user: currentUserId === row.userId,
    };
  }

  private toReferralMe(
    row: ReferralLeaderboardRankedRow,
    userAhead: ReferralLeaderboardEntry | ReferralLeaderboardRankedRow | null,
    leaderboard: ReferralLeaderboardEntry[],
  ): ReferralMe {
    const cutoffReferrals =
      leaderboard.length >= this.leaderboardLimit
        ? leaderboard[this.leaderboardLimit - 1].total_referrals
        : 0;

    return {
      user_id: row.userId,
      display_name: row.displayName,
      username: row.username,
      profile_picture_url: row.profilePictureUrl,
      referral_code: row.referralCode,
      total_referrals: row.totalReferrals,
      total_earnings: row.totalEarnings,
      rank: row.rank,
      level: row.level,
      streak: row.streak,
      xp: row.xp,
      quiz_completed: row.quizCompleted,
      referrals_to_next_rank: userAhead
        ? this.getReferralsNeededToBeat(
            this.getComparableReferralTotal(userAhead),
            row.totalReferrals,
          )
        : 0,
      referrals_to_top_5:
        row.rank <= this.leaderboardLimit
          ? 0
          : this.getReferralsNeededToBeat(cutoffReferrals, row.totalReferrals),
      next_milestone: this.getNextMilestone(row.totalReferrals),
    };
  }

  private buildCallToAction(
    me: ReferralMe,
    leaderboard: ReferralLeaderboardEntry[],
  ): ReferralCallToAction {
    const shareMessage = me.referral_code
      ? `Use my EduLearn referral code ${me.referral_code} and join me on the app.`
      : 'Invite a friend to join you on EduLearn.';

    if (me.total_referrals === 0) {
      return {
        primary_goal: 'earn_first_referral',
        title: 'Get your first referral on the board',
        subtitle:
          'Share your code once to unlock momentum and start climbing the leaderboard.',
        share_message: shareMessage,
      };
    }

    if (me.rank === 1) {
      return {
        primary_goal: 'hold_rank',
        title: 'You are leading the referral board',
        subtitle:
          'Keep sharing your code to protect the top spot and widen the gap.',
        share_message: shareMessage,
      };
    }

    if (me.rank <= this.leaderboardLimit) {
      return {
        primary_goal: 'climb_rank',
        title: `${me.referrals_to_next_rank} more ${this.getReferralWord(
          me.referrals_to_next_rank,
        )} to reach #${me.rank - 1}`,
        subtitle: `You are already in the top ${this.leaderboardLimit}. One solid share push can move you up again.`,
        share_message: shareMessage,
      };
    }

    const cutoff = leaderboard[this.leaderboardLimit - 1]?.total_referrals ?? 0;

    return {
      primary_goal: 'break_top_5',
      title: `${me.referrals_to_top_5} more ${this.getReferralWord(
        me.referrals_to_top_5,
      )} to break into the top ${this.leaderboardLimit}`,
      subtitle: `You are #${me.rank} right now. The current #${this.leaderboardLimit} spot sits at ${cutoff} referrals.`,
      share_message: shareMessage,
    };
  }

  private getNextMilestone(totalReferrals: number): ReferralMilestone {
    const nextMilestone = this.referralMilestones.find(
      (milestone) => milestone.target > totalReferrals,
    );

    if (!nextMilestone) {
      return {
        target: null,
        remaining: 0,
        progress_percent: 100,
        label: 'You have cleared every current milestone',
      };
    }

    return {
      target: nextMilestone.target,
      remaining: nextMilestone.target - totalReferrals,
      progress_percent: Math.min(
        100,
        Math.round((totalReferrals / nextMilestone.target) * 100),
      ),
      label: nextMilestone.label,
    };
  }

  private getReferralsNeededToBeat(
    targetReferrals: number,
    currentReferrals: number,
  ): number {
    return Math.max(1, targetReferrals - currentReferrals + 1);
  }

  private getComparableReferralTotal(
    row: ReferralLeaderboardEntry | ReferralLeaderboardRankedRow,
  ): number {
    return 'total_referrals' in row ? row.total_referrals : row.totalReferrals;
  }

  private getHighlightLabel(rank: number, totalReferrals: number): string {
    if (rank === 1) return 'Top referrer';
    if (rank <= 3) return 'Podium spot';
    if (totalReferrals >= 10) return 'Power inviter';
    if (totalReferrals >= 5) return 'Climbing fast';
    return 'Rising referrer';
  }

  private getReferralWord(count: number): string {
    return count === 1 ? 'referral' : 'referrals';
  }
}
