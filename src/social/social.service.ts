import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import db from '../../drizzle';
import { userFollows, user, type User } from '../../lib/db/schema';
import { NotificationsService } from '../common/services/notifications.service';
import { ResendService } from '../resend/resend.service';

@Injectable()
export class SocialService {
  constructor(
    private notificationsService: NotificationsService,
    private resendService: ResendService,
  ) {}

  async followUser(
    followerId: string,
    followingId: string,
    preferences?: {
      emailNotifications?: boolean;
      pushNotifications?: boolean;
      inAppNotifications?: boolean;
    },
  ): Promise<void> {
    if (followerId === followingId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const followerExists = await db
      .select()
      .from(user)
      .where(eq(user.id, followerId))
      .limit(1);

    if (!followerExists.length) {
      throw new NotFoundException(`Follower user not found`);
    }

    const followingExists = await db
      .select()
      .from(user)
      .where(eq(user.id, followingId))
      .limit(1);

    if (!followingExists.length) {
      throw new NotFoundException(`User to follow not found`);
    }

    const existingFollow = await db
      .select()
      .from(userFollows)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followingId, followingId),
        ),
      )
      .limit(1);

    if (existingFollow.length > 0) {
      throw new BadRequestException('You are already following this user');
    }

    await db.insert(userFollows).values({
      followerId,
      followingId,
      emailNotifications: preferences?.emailNotifications ?? true,
      pushNotifications: preferences?.pushNotifications ?? true,
      inAppNotifications: preferences?.inAppNotifications ?? true,
    });

    await this.notificationsService.createNotification({
      title: '👥 New Follower!',
      content: `${followerExists[0].username} started following you!`,
      userId: followingId,
      type: 'system_announcement',
    });
  }

  async unfollowUser(followerId: string, followingId: string): Promise<void> {
    if (followerId === followingId) {
      throw new BadRequestException('Invalid operation');
    }

    const result = await db
      .delete(userFollows)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followingId, followingId),
        ),
      )
      .returning();

    if (!result.length) {
      throw new NotFoundException('Follow relationship not found');
    }
  }

  async getFollowers(userId: string): Promise<Partial<User>[]> {
    const followers = await db
      .select({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        profilePictureURL: user.profilePictureURL,
        level: user.level,
        xp: user.xp,
        verified: user.verified,
        createdAt: userFollows.createdAt,
      })
      .from(userFollows)
      .innerJoin(user, eq(userFollows.followerId, user.id))
      .where(eq(userFollows.followingId, userId));

    return followers;
  }

  async getFollowing(userId: string): Promise<Partial<User>[]> {
    const following = await db
      .select({
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        profilePictureURL: user.profilePictureURL,
        level: user.level,
        xp: user.xp,
        verified: user.verified,
        createdAt: userFollows.createdAt,
      })
      .from(userFollows)
      .innerJoin(user, eq(userFollows.followingId, user.id))
      .where(eq(userFollows.followerId, userId));

    return following;
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const result = await db
      .select()
      .from(userFollows)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followingId, followingId),
        ),
      )
      .limit(1);

    return result.length > 0;
  }

  async getFollowerCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(userFollows)
      .where(eq(userFollows.followingId, userId));

    return Number(result[0]?.count || 0);
  }

  async getFollowingCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(userFollows)
      .where(eq(userFollows.followerId, userId));

    return Number(result[0]?.count || 0);
  }

  async getFollowStats(userId: string): Promise<{
    followersCount: number;
    followingCount: number;
  }> {
    const [followersCount, followingCount] = await Promise.all([
      this.getFollowerCount(userId),
      this.getFollowingCount(userId),
    ]);

    return {
      followersCount,
      followingCount,
    };
  }

  async updateNotificationPreferences(
    followerId: string,
    followingId: string,
    preferences: {
      emailNotifications?: boolean;
      pushNotifications?: boolean;
      inAppNotifications?: boolean;
    },
  ): Promise<void> {
    const existingFollow = await db
      .select()
      .from(userFollows)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followingId, followingId),
        ),
      )
      .limit(1);

    if (!existingFollow.length) {
      throw new NotFoundException('Follow relationship not found');
    }

    await db
      .update(userFollows)
      .set(preferences)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followingId, followingId),
        ),
      );
  }

  async getNotificationPreferences(
    followerId: string,
    followingId: string,
  ): Promise<{
    emailNotifications: boolean;
    pushNotifications: boolean;
    inAppNotifications: boolean;
  }> {
    const result = await db
      .select({
        emailNotifications: userFollows.emailNotifications,
        pushNotifications: userFollows.pushNotifications,
        inAppNotifications: userFollows.inAppNotifications,
      })
      .from(userFollows)
      .where(
        and(
          eq(userFollows.followerId, followerId),
          eq(userFollows.followingId, followingId),
        ),
      )
      .limit(1);

    if (!result.length) {
      throw new NotFoundException('Follow relationship not found');
    }

    return {
      emailNotifications: result[0].emailNotifications ?? true,
      pushNotifications: result[0].pushNotifications ?? true,
      inAppNotifications: result[0].inAppNotifications ?? true,
    };
  }

  async notifyFollowers(
    userId: string,
    event: {
      type: 'level_up' | 'earnings_claimed' | 'nft_earned';
      data: any;
    },
  ): Promise<void> {
    const followersQuery = await db
      .select({
        id: user.id,
        username: user.username,
        email: user.email,
        emailNotifications: userFollows.emailNotifications,
        pushNotifications: userFollows.pushNotifications,
        inAppNotifications: userFollows.inAppNotifications,
      })
      .from(userFollows)
      .innerJoin(user, eq(userFollows.followerId, user.id))
      .where(eq(userFollows.followingId, userId));

    const userInfo = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!userInfo.length) return;

    const username = userInfo[0].username ?? 'User';
    let title = '';
    let content = '';

    switch (event.type) {
      case 'level_up':
        title = `🎉 ${username} reached ${event.data.level} level!`;
        content = `${username} just leveled up to ${event.data.level}. Keep learning together!`;
        break;
      case 'earnings_claimed':
        title = `💰 ${username} claimed $${event.data.amount} in earnings!`;
        content = `${username} just claimed their rewards. You can earn too!`;
        break;
      case 'nft_earned':
        title = `🏆 ${username} earned ${event.data.nftTitle}!`;
        content = `${username} just earned the ${event.data.nftTitle} NFT certificate!`;
        break;
    }

    const notificationPromises = followersQuery.map(async (follower) => {
      // Check email notification preferences
      if (follower.emailNotifications) {
        if (event.type === 'level_up') {
          await this.resendService.sendLevelUpEmail(
            follower.email as string,
            follower.username as string,
            userInfo[0].name as string,
            event.data.level,
            event.data.levelTitle,
            event.data.xpTotal,
          );
        } else if (event.type === 'nft_earned') {
          await this.resendService.sendNFTFollowingEmail(
            follower.email as string,
            follower.username as string,
            username,
            event.data.nftTitle,
            event.data.nftDescription,
            event.data.imageUrl,
          );
        }
      }

      // Check in-app and push notification preferences
      if (follower.inAppNotifications || follower.pushNotifications) {
        await this.notificationsService.createNotification(
          {
            title,
            content,
            userId: follower.id as string,
            type:
              event.type === 'nft_earned' && event.data?.nftId
                ? 'nft_claimed'
                : 'system_announcement',
            metadata:
              event.type === 'nft_earned' && event.data?.nftId
                ? { nftId: event.data.nftId as string }
                : {},
          },
          follower.pushNotifications ?? true,
        );
      }
    });

    await Promise.allSettled(notificationPromises);
  }
}
