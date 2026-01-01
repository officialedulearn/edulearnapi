import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import db from "../../../drizzle"
import {user, notifications} from "../../../lib/db/schema"
import { ExpoPushService } from 'src/common/services/expo-push.service';
import { eq, and, desc, asc } from 'drizzle-orm';

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name)
    constructor(private expoPushService: ExpoPushService) {}
    async createNotification(notification: {title: string, content: string, userId: string}, sendPush: boolean = true) {
        try {
            const userResponse = await db.select().from(user).where(eq(user.id, notification.userId))
            if(sendPush && userResponse[0].expoPushToken) {
                await this.expoPushService.sendPushNotification(userResponse[0].expoPushToken, notification.title, notification.content)
            }
            await db.insert(notifications).values(notification)

        } catch (error) {
            this.logger.error('Failed to create notification', (error as Error)?.stack)
            throw new InternalServerErrorException('Failed to create notification')
        }
    }

    async deleteNotification(notificationId: string, userId: string) {
        try {
            await db.delete(notifications).where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
        } catch (error) {
            this.logger.error('Failed to delete notification', (error as Error)?.stack)
            throw new InternalServerErrorException('Failed to delete notification')
        }
    }

    async getUserNotificationsByCreatedAt(userId: string, order: 'asc' | 'desc' = 'desc') {
        try {
            const orderExpr = order === 'asc' ? asc(notifications.createdAt) : desc(notifications.createdAt)
            return await db.select().from(notifications).where(eq(notifications.userId, userId)).orderBy(orderExpr)
        } catch (error) {
            this.logger.error('Failed to get notifications', (error as Error)?.stack)
            throw new InternalServerErrorException('Failed to get notifications')
        }
    }

}
