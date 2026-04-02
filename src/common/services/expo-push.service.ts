import { Injectable } from '@nestjs/common';
import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';

export interface PushNotificationData {
  screen?: string;
  id?: string;
  [key: string]: any;
}

@Injectable()
export class ExpoPushService {
  private expo: Expo;

  constructor() {
    this.expo = new Expo();
  }

  async sendPushNotification(
    expoPushToken: string,
    title: string,
    body: string,
    data?: PushNotificationData,
  ): Promise<boolean> {
    if (!Expo.isExpoPushToken(expoPushToken)) {
      console.error(
        `Push token ${expoPushToken} is not a valid Expo push token`,
      );
      return false;
    }

    const message: ExpoPushMessage = {
      to: expoPushToken,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
    };

    try {
      const ticketChunk = await this.expo.sendPushNotificationsAsync([message]);
      console.log('Push notification sent:', ticketChunk);

      return this.checkTicketSuccess(ticketChunk[0]);
    } catch (error) {
      console.error('Error sending push notification:', error);
      return false;
    }
  }

  async sendBulkPushNotifications(
    notifications: Array<{
      expoPushToken: string;
      title: string;
      body: string;
      data?: PushNotificationData;
    }>,
  ): Promise<{ success: number; failed: number }> {
    const messages: ExpoPushMessage[] = [];

    for (const notification of notifications) {
      if (!Expo.isExpoPushToken(notification.expoPushToken)) {
        console.warn(`Skipping invalid token: ${notification.expoPushToken}`);
        continue;
      }

      messages.push({
        to: notification.expoPushToken,
        sound: 'default',
        title: notification.title,
        body: notification.body,
        data: notification.data,
        priority: 'high',
      });
    }

    if (messages.length === 0) {
      console.warn('No valid push tokens found');
      return { success: 0, failed: 0 };
    }

    let successCount = 0;
    let failedCount = 0;

    try {
      // Expo recommends chunking push notifications
      const chunks = this.expo.chunkPushNotifications(messages);

      for (const chunk of chunks) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);

          ticketChunk.forEach((ticket) => {
            if (this.checkTicketSuccess(ticket)) {
              successCount++;
            } else {
              failedCount++;
            }
          });
        } catch (error) {
          console.error('Error sending chunk:', error);
          failedCount += chunk.length;
        }
      }

      console.log(
        `Bulk push notifications sent: ${successCount} success, ${failedCount} failed`,
      );
      return { success: successCount, failed: failedCount };
    } catch (error) {
      console.error('Error in bulk push notification:', error);
      return { success: 0, failed: messages.length };
    }
  }

  private checkTicketSuccess(ticket: ExpoPushTicket): boolean {
    if (ticket.status === 'error') {
      console.error(`Push notification error: ${ticket.message}`);
      if (ticket.details?.error) {
        console.error(`Error details: ${ticket.details.error}`);
      }
      return false;
    }
    return true;
  }

  isValidExpoPushToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  async sendNavigationNotification(
    expoPushToken: string,
    title: string,
    body: string,
    screen: string,
    id?: string,
  ): Promise<boolean> {
    return this.sendPushNotification(expoPushToken, title, body, {
      screen,
      id,
    });
  }

  async sendReminderNotification(
    expoPushToken: string,
    reminderType: 'daily' | 'quiz' | 'streak',
  ): Promise<boolean> {
    const reminders = {
      daily: {
        title: '📚 Daily Learning Reminder',
        body: "Keep your streak alive! Complete today's lesson.",
        data: { screen: 'home' },
      },
      quiz: {
        title: '🎯 Quiz Time!',
        body: "Test your knowledge with today's quiz.",
        data: { screen: 'quiz' },
      },
      streak: {
        title: "🔥 Don't Break Your Streak!",
        body: "You're doing great! Keep learning to maintain your streak.",
        data: { screen: 'profile' },
      },
    };

    const reminder = reminders[reminderType];
    return this.sendPushNotification(
      expoPushToken,
      reminder.title,
      reminder.body,
      reminder.data,
    );
  }
}
