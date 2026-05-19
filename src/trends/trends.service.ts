import { Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import db from '../../drizzle';
import { publicQuiz, user, userFollows } from '../../lib/db/schema';
import { RedisService } from '../redis/redis.service';

export type HubTrendingUser = {
  id: string;
  name: string;
  username: string | null;
  profilePictureURL: string | null;
  level: string;
  xp: number;
  followersCount: number;
};

export type HubTrendingQuiz = {
  id: string;
  title: string;
  description: string | null;
  createdBy: string;
  creatorUsername: string | null;
  viewCount: number;
  attemptCount: number;
  createdAt: string;
};

export type HubTrendsResponse = {
  users: HubTrendingUser[];
  quizzes: HubTrendingQuiz[];
};

const HUB_TRENDS_CACHE_TTL_SECONDS = 60;
const HUB_TRENDS_DEFAULT_LIMIT = 10;
const HUB_TRENDS_MAX_LIMIT = 25;

@Injectable()
export class TrendsService {
  constructor(private readonly redisService: RedisService) {}

  async getHubTrends(limit?: number): Promise<HubTrendsResponse> {
    const normalizedLimit = this.normalizeLimit(limit);
    const cacheKey = `trends:hub:v1:limit:${normalizedLimit}`;

    const cached = await this.readCachedHubTrends(cacheKey);
    if (cached) {
      return cached;
    }

    const trends = await this.fetchHubTrendsFromDb(normalizedLimit);
    await this.writeCachedHubTrends(cacheKey, trends);
    return trends;
  }

  private normalizeLimit(limit?: number): number {
    if (!Number.isFinite(limit) || !limit || limit < 1) {
      return HUB_TRENDS_DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(limit), HUB_TRENDS_MAX_LIMIT);
  }

  private async readCachedHubTrends(
    cacheKey: string,
  ): Promise<HubTrendsResponse | null> {
    try {
      const cached = await this.redisService.getHubTrendsPayload(cacheKey);
      if (!cached) {
        return null;
      }
      return JSON.parse(cached) as HubTrendsResponse;
    } catch {
      return null;
    }
  }

  private async writeCachedHubTrends(
    cacheKey: string,
    trends: HubTrendsResponse,
  ): Promise<void> {
    try {
      await this.redisService.setHubTrendsPayload(
        cacheKey,
        HUB_TRENDS_CACHE_TTL_SECONDS,
        JSON.stringify(trends),
      );
    } catch {
      // Redis should never block serving fresh trends.
    }
  }

  private async fetchHubTrendsFromDb(
    limit: number,
  ): Promise<HubTrendsResponse> {
    const followersCount = sql<number>`count(${userFollows.followerId})`;

    const [users, quizzes] = await Promise.all([
      db
        .select({
          id: user.id,
          name: user.name,
          username: user.username,
          profilePictureURL: user.profilePictureURL,
          level: user.level,
          xp: user.xp,
          followersCount,
        })
        .from(user)
        .leftJoin(userFollows, eq(userFollows.followingId, user.id))
        .groupBy(
          user.id,
          user.name,
          user.username,
          user.profilePictureURL,
          user.level,
          user.xp,
        )
        .orderBy(desc(followersCount), desc(user.xp))
        .limit(limit),
      db
        .select({
          id: publicQuiz.id,
          title: publicQuiz.title,
          description: publicQuiz.description,
          createdBy: publicQuiz.createdBy,
          creatorUsername: user.username,
          viewCount: publicQuiz.viewCount,
          attemptCount: publicQuiz.attemptCount,
          createdAt: publicQuiz.createdAt,
        })
        .from(publicQuiz)
        .leftJoin(user, eq(publicQuiz.createdBy, user.id))
        .orderBy(
          desc(publicQuiz.attemptCount),
          desc(publicQuiz.viewCount),
          desc(publicQuiz.createdAt),
        )
        .limit(limit),
    ]);

    return {
      users: users.map((row) => ({
        id: row.id,
        name: row.name,
        username: row.username,
        profilePictureURL: row.profilePictureURL,
        level: row.level,
        xp: row.xp,
        followersCount: Number(row.followersCount ?? 0),
      })),
      quizzes: quizzes.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        createdBy: row.createdBy,
        creatorUsername: row.creatorUsername,
        viewCount: row.viewCount,
        attemptCount: row.attemptCount,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : String(row.createdAt),
      })),
    };
  }
}
