import { Injectable, Logger } from '@nestjs/common';
import { sql, eq, gte, lte, and, desc, count } from 'drizzle-orm';
import db from '../../drizzle';
import { user, xpActivity, reward, userReward, premiumTransactions, totalVolumes, chat } from '../../lib/db/schema';
import { NotificationsService } from '../common/services/notifications.service';
import { ResendService } from '../resend/resend.service';
import { ExpoPushService } from '../common/services/expo-push.service';

export interface SignupStats {
  daily: { date: string; count: number }[];
  weekly: { week: string; count: number }[];
  monthly: { month: string; count: number }[];
  total: number;
}

export interface PlatformMetrics {
  totalUsers: number;
  premiumUsers: number;
  premiumConversionRate: number;
  totalQuizzesCompleted: number;
  averageQuizzesPerUser: number;
  totalXPEarned: number;
  averageXPPerUser: number;
  totalChats: number;
  totalRewards: number;
  totalRevenue: string;
  activeUsersToday: number;
  activeUsersWeek: number;
  activeUsersMonth: number;
}

export interface ActivityTrend {
  date: string;
  quiz: number;
  chat: number;
  streak: number;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly resendService: ResendService,
    private readonly expoPushService: ExpoPushService,
  ) {}

  private async retryQuery<T>(
    queryFn: () => Promise<T>,
    retries = 3,
    delay = 1000,
  ): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await queryFn();
      } catch (error: any) {
        const isConnectionError = 
          error?.cause?.code === 'XX000' ||
          error?.cause?.message?.includes('Tenant or user not found') ||
          error?.code === 'ECONNRESET' ||
          error?.message?.includes('connection');

        if (isConnectionError && i < retries - 1) {
          this.logger.warn(`Database connection error, retrying... (${i + 1}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Query failed after retries');
  }

  async getSignupStats(startDate?: Date, endDate?: Date): Promise<SignupStats> {
    const start = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const end = endDate || new Date();

    const users = await this.retryQuery(() =>
      db.select({
        id: user.id,
        lastLoggedIn: user.lastLoggedIn,
      }).from(user)
    );

    const dailyMap = new Map<string, number>();
    const weeklyMap = new Map<string, number>();
    const monthlyMap = new Map<string, number>();

    users.forEach(u => {
      const date = new Date(u.lastLoggedIn);
      if (date >= start && date <= end) {
        const dayKey = date.toISOString().split('T')[0];
        dailyMap.set(dayKey, (dailyMap.get(dayKey) || 0) + 1);

        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        const weekKey = weekStart.toISOString().split('T')[0];
        weeklyMap.set(weekKey, (weeklyMap.get(weekKey) || 0) + 1);

        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + 1);
      }
    });

    return {
      daily: Array.from(dailyMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      weekly: Array.from(weeklyMap.entries())
        .map(([week, count]) => ({ week, count }))
        .sort((a, b) => a.week.localeCompare(b.week)),
      monthly: Array.from(monthlyMap.entries())
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      total: users.length,
    };
  }

  async getPlatformMetrics(): Promise<PlatformMetrics> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [users, activities, rewards, chats, volumes] = await this.retryQuery(() =>
      Promise.all([
        db.select().from(user),
        db.select().from(xpActivity),
        db.select().from(reward),
        db.select().from(chat),
        db.select().from(totalVolumes).limit(1),
      ])
    );

    const totalUsers = users.length;
    const premiumUsers = users.filter(u => u.isPremium).length;
    const totalXP = users.reduce((sum, u) => sum + u.xp, 0);
    const totalQuizzes = users.reduce((sum, u) => sum + u.quizCompleted, 0);

    const activeToday = users.filter(u => new Date(u.lastLoggedIn) >= oneDayAgo).length;
    const activeWeek = users.filter(u => new Date(u.lastLoggedIn) >= oneWeekAgo).length;
    const activeMonth = users.filter(u => new Date(u.lastLoggedIn) >= oneMonthAgo).length;

    return {
      totalUsers,
      premiumUsers,
      premiumConversionRate: totalUsers > 0 ? (premiumUsers / totalUsers) * 100 : 0,
      totalQuizzesCompleted: totalQuizzes,
      averageQuizzesPerUser: totalUsers > 0 ? Math.round(totalQuizzes / totalUsers) : 0,
      totalXPEarned: totalXP,
      averageXPPerUser: totalUsers > 0 ? Math.round(totalXP / totalUsers) : 0,
      totalChats: chats.length,
      totalRewards: rewards.length,
      totalRevenue: volumes[0]?.totalRevenue || '0.00',
      activeUsersToday: activeToday,
      activeUsersWeek: activeWeek,
      activeUsersMonth: activeMonth,
    };
  }

  async getActivityTrends(days: number = 30): Promise<ActivityTrend[]> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const activities = await this.retryQuery(() =>
      db.select().from(xpActivity)
        .where(gte(xpActivity.createdAt, startDate))
    );

    const trendsMap = new Map<string, { quiz: number; chat: number; streak: number }>();

    activities.forEach(activity => {
      const dateKey = new Date(activity.createdAt).toISOString().split('T')[0];
      const existing = trendsMap.get(dateKey) || { quiz: 0, chat: 0, streak: 0 };
      
      if (activity.type === 'quiz') existing.quiz++;
      else if (activity.type === 'chat') existing.chat++;
      else if (activity.type === 'streak') existing.streak++;
      
      trendsMap.set(dateKey, existing);
    });

    return Array.from(trendsMap.entries())
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async broadcastNotification(title: string, content: string): Promise<{ sent: number; failed: number }> {
    const users = await db.select({
      id: user.id,
      expoPushToken: user.expoPushToken,
    }).from(user);

    let sent = 0;
    let failed = 0;

    for (const u of users) {
      try {
        await this.notificationsService.createNotification({
          title,
          content,
          userId: u.id,
        });
        sent++;
      } catch (error) {
        this.logger.error(`Failed to send notification to user ${u.id}`, error);
        failed++;
      }
    }

    return { sent, failed };
  }

  async sendNotificationToUsers(userIds: string[], title: string, content: string): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        await this.notificationsService.createNotification({
          title,
          content,
          userId,
        });
        sent++;
      } catch (error) {
        this.logger.error(`Failed to send notification to user ${userId}`, error);
        failed++;
      }
    }

    return { sent, failed };
  }

  async broadcastEmail(subject: string, htmlContent: string): Promise<{ sent: number; failed: number }> {
    const users = await db.select({
      email: user.email,
      name: user.name,
    }).from(user);

    let sent = 0;
    let failed = 0;

    for (const u of users) {
      try {
        await this.resendService.sendEmail(u.email, subject, htmlContent);
        sent++;
      } catch (error) {
        this.logger.error(`Failed to send email to ${u.email}`, error);
        failed++;
      }
    }

    return { sent, failed };
  }

  async sendEmailToUsers(emails: string[], subject: string, htmlContent: string): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const email of emails) {
      try {
        await this.resendService.sendEmail(email, subject, htmlContent);
        sent++;
      } catch (error) {
        this.logger.error(`Failed to send email to ${email}`, error);
        failed++;
      }
    }

    return { sent, failed };
  }

  async getAllUsersForAdmin() {
    return await this.retryQuery(() =>
      db.select({
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        xp: user.xp,
        level: user.level,
        isPremium: user.isPremium,
        verified: user.verified,
        lastLoggedIn: user.lastLoggedIn,
        expoPushToken: user.expoPushToken,
      }).from(user).orderBy(desc(user.lastLoggedIn))
    );
  }
}


