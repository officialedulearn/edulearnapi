import { Injectable, Logger } from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import db from '../../drizzle';
import { weeklyLeaderboard, user } from '../../lib/db/schema';

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);

  getWeekBounds(date: Date = new Date()): { start: Date; end: Date } {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
  }

  async trackWeeklyXP(userId: string, xpEarned: number) {
    const { start, end } = this.getWeekBounds();
    const existing = await db
      .select()
      .from(weeklyLeaderboard)
      .where(
        and(
          eq(weeklyLeaderboard.userId, userId),
          eq(weeklyLeaderboard.weekStart, start),
        ),
      );

    if (existing.length > 0) {
      await db
        .update(weeklyLeaderboard)
        .set({ xpEarned: existing[0].xpEarned + xpEarned })
        .where(eq(weeklyLeaderboard.id, existing[0].id));
    } else {
      await db.insert(weeklyLeaderboard).values({
        userId,
        weekStart: start,
        weekEnd: end,
        xpEarned,
      });
    }
  }

  async getWeeklyLeaderboard(weekStart?: Date) {
    const { start, end } = weekStart
      ? {
          start: weekStart,
          end: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
        }
      : this.getWeekBounds();

    const results = await db
      .select({
        userId: weeklyLeaderboard.userId,
        xpEarned: weeklyLeaderboard.xpEarned,
        rank: weeklyLeaderboard.rank,
        name: user.name,
        level: user.level,
        profilePictureURL: user.profilePictureURL,
        streak: user.streak,
      })
      .from(weeklyLeaderboard)
      .leftJoin(user, eq(weeklyLeaderboard.userId, user.id))
      .where(
        and(
          eq(weeklyLeaderboard.weekStart, start),
          eq(weeklyLeaderboard.weekEnd, end),
        ),
      )
      .orderBy(desc(weeklyLeaderboard.xpEarned))
      .limit(10);

    return results.map((r, idx) => ({
      ...r,
      xp: r.xpEarned,
      rank: idx + 1,
    }));
  }

  async finalizeWeeklyLeaderboard(): Promise<
    Array<{ userId: string; xpEarned: number; user: typeof user.$inferSelect }>
  > {
    const { start } = this.getWeekBounds();
    const previousWeekStart = new Date(start);
    previousWeekStart.setDate(previousWeekStart.getDate() - 7);

    const results = await db
      .select()
      .from(weeklyLeaderboard)
      .leftJoin(user, eq(weeklyLeaderboard.userId, user.id))
      .where(
        and(
          eq(weeklyLeaderboard.weekStart, previousWeekStart),
          eq(weeklyLeaderboard.prizeAwarded, false),
        ),
      )
      .orderBy(desc(weeklyLeaderboard.xpEarned))
      .limit(3);

    const topUsers = results
      .filter((r) => r.user)
      .map((r) => ({
        userId: r.weekly_leaderboard.userId,
        xpEarned: r.weekly_leaderboard.xpEarned,
        recordId: r.weekly_leaderboard.id,
        user: r.user as typeof user.$inferSelect,
      }));

    for (let i = 0; i < topUsers.length; i++) {
      await db
        .update(weeklyLeaderboard)
        .set({ rank: i + 1, prizeAwarded: true })
        .where(eq(weeklyLeaderboard.id, topUsers[i].recordId));
    }

    return topUsers;
  }
}
