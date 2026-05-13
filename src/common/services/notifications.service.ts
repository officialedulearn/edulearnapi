import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import db from '../../../drizzle';
import { user, notifications } from '../../../lib/db/schema';
import { ExpoPushService } from 'src/common/services/expo-push.service';
import { eq, and, desc, asc } from 'drizzle-orm';
import type { PushNotificationData } from 'src/common/services/expo-push.service';
import {
  type NotificationMetadataMap,
  type NotificationType,
} from 'src/common/notifications/notification-types';

type CreateNotificationInput = {
  title: string;
  content: string;
  userId: string;
  type: NotificationType;
  metadata?: NotificationMetadataMap[NotificationType];
  data?: PushNotificationData;
};

const hasString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const validateNotificationMetadata = (
  type: NotificationType,
  metadata: unknown,
) => {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'quiz_ready':
      if (!hasString(meta.quizId)) {
        throw new BadRequestException(
          'quiz_ready notification metadata requires quizId',
        );
      }
      break;
    case 'roadmap_ready':
      if (!hasString(meta.roadmapId)) {
        throw new BadRequestException(
          'roadmap_ready notification metadata requires roadmapId',
        );
      }
      break;
    case 'roadmap_step_ready':
      if (!hasString(meta.roadmapId)) {
        throw new BadRequestException(
          'roadmap_step_ready notification metadata requires roadmapId',
        );
      }
      if (!hasString(meta.stepId)) {
        throw new BadRequestException(
          'roadmap_step_ready notification metadata requires stepId',
        );
      }
      if (!hasString(meta.chatId)) {
        throw new BadRequestException(
          'roadmap_step_ready notification metadata requires chatId',
        );
      }
      break;
    case 'mention':
      if (!hasString(meta.communityId)) {
        throw new BadRequestException(
          'mention notification metadata requires communityId',
        );
      }
      break;
    case 'nft_claimed':
      if (!hasString(meta.nftId)) {
        throw new BadRequestException(
          'nft_claimed notification metadata requires nftId',
        );
      }
      break;
    case 'leaderboard_update':
    case 'streak_warning':
    case 'system_announcement':
      break;
    default:
      throw new BadRequestException('Unsupported notification type');
  }
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(private expoPushService: ExpoPushService) {}
  async createNotification(
    notification: CreateNotificationInput,
    sendPush: boolean = true,
  ) {
    try {
      validateNotificationMetadata(notification.type, notification.metadata);
      const userResponse = await db
        .select()
        .from(user)
        .where(eq(user.id, notification.userId));
      if (sendPush && userResponse[0].expoPushToken) {
        await this.expoPushService.sendPushNotification(
          userResponse[0].expoPushToken,
          notification.title,
          notification.content,
          notification.data,
        );
      }
      await db.insert(notifications).values({
        title: notification.title,
        content: notification.content,
        type: notification.type,
        metadata: notification.metadata ?? {},
        userId: notification.userId,
      });
    } catch (error) {
      this.logger.error(
        'Failed to create notification',
        (error as Error)?.stack,
      );
      throw new InternalServerErrorException('Failed to create notification');
    }
  }

  async deleteNotification(notificationId: string, userId: string) {
    try {
      await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.userId, userId),
          ),
        );
    } catch (error) {
      this.logger.error(
        'Failed to delete notification',
        (error as Error)?.stack,
      );
      throw new InternalServerErrorException('Failed to delete notification');
    }
  }

  async deleteAllNotificationsForUser(userId: string) {
    try {
      await db.delete(notifications).where(eq(notifications.userId, userId));
    } catch (error) {
      this.logger.error(
        'Failed to delete all notifications',
        (error as Error)?.stack,
      );
      throw new InternalServerErrorException(
        'Failed to delete all notifications',
      );
    }
  }

  async getUserNotificationsByCreatedAt(
    userId: string,
    order: 'asc' | 'desc' = 'desc',
  ) {
    try {
      const orderExpr =
        order === 'asc'
          ? asc(notifications.createdAt)
          : desc(notifications.createdAt);
      return await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(orderExpr);
    } catch (error) {
      this.logger.error('Failed to get notifications', (error as Error)?.stack);
      throw new InternalServerErrorException('Failed to get notifications');
    }
  }
}
