import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql, eq, gte, lte, and, desc, count } from 'drizzle-orm';
import db from '../../drizzle';
import { user, xpActivity, reward, userReward, premiumTransactions, totalVolumes, chat, community, community_members, feedback } from '../../lib/db/schema';
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
    const htmlWithUnsubscribe = htmlContent.includes('{{{RESEND_UNSUBSCRIBE_URL}}}')
      ? htmlContent
      : htmlContent.replace(
          '</body>',
          '<p style="margin:8px 0 0 0;color:#9E9E9E;font-size:12px;"><a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#61728C;text-decoration:underline;">Unsubscribe</a></p></body>',
        );
    await this.resendService.createBroadcast(subject, htmlWithUnsubscribe);
    const contacts = await this.resendService.getResendContacts();
    const total = contacts.length;
    return { sent: total, failed: 0 };
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

  async broadcastV25Announcement(): Promise<{ sent: number; failed: number; total: number }> {
    try {
      return await this.resendService.broadcastV25Announcement();
    } catch (error) {
      this.logger.error('Failed to broadcast v2.5 announcement', error);
      throw error;
    }
  }

  async sendV25AnnouncementTest(email: string, name?: string): Promise<{ sent: boolean }> {
    try {
      await this.resendService.sendV25AnnouncementEmail(email, name || 'Test User');
      return { sent: true };
    } catch (error) {
      this.logger.error('Failed to send v2.5 announcement test', error);
      throw error;
    }
  }

  async getEmailPreview(
    template: string,
    params: { name?: string; referralCode?: string; referralCount?: number },
  ): Promise<{ html: string }> {
    const valid = ['come-back-soon', 'refer-friends', 'streak-reminder', 'eddy-tip', 'referral-superstar'];
    if (!valid.includes(template)) {
      throw new NotFoundException(`Unknown template: ${template}`);
    }
    const html = await this.resendService.getEngagementPreviewHtml(template as any, {
      name: params.name || 'Test User',
      referralCode: params.referralCode,
      referralCount: params.referralCount,
    });
    return { html };
  }

  async sendEngagementTest(
    template: string,
    email: string,
    params: { name?: string; referralCode?: string; referralCount?: number },
  ): Promise<{ sent: boolean }> {
    const valid = ['come-back-soon', 'refer-friends', 'streak-reminder', 'eddy-tip', 'referral-superstar'];
    if (!valid.includes(template)) {
      throw new NotFoundException(`Unknown template: ${template}`);
    }
    await this.resendService.sendEngagementEmail(template as any, email, {
      name: params.name || 'Test User',
      referralCode: params.referralCode,
      referralCount: params.referralCount,
    });
    return { sent: true };
  }

  async broadcastEngagement(template: string): Promise<{ sent: number; failed: number; total: number }> {
    const valid = ['come-back-soon', 'refer-friends', 'streak-reminder', 'eddy-tip', 'referral-superstar'];
    if (!valid.includes(template)) {
      throw new NotFoundException(`Unknown template: ${template}`);
    }
    return await this.resendService.broadcastEngagement(template as any);
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

  async getEngagementMetrics() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [users, activities] = await this.retryQuery(() =>
      Promise.all([
        db.select().from(user),
        db.select().from(xpActivity),
      ])
    );

    const dau = users.filter(u => new Date(u.lastLoggedIn) >= oneDayAgo).length;
    const wau = users.filter(u => new Date(u.lastLoggedIn) >= sevenDaysAgo).length;
    const mau = users.filter(u => new Date(u.lastLoggedIn) >= thirtyDaysAgo).length;

    const featureUsage = {
      quiz: activities.filter(a => a.type === 'quiz').length,
      chat: activities.filter(a => a.type === 'chat').length,
      streak: activities.filter(a => a.type === 'streak').length,
    };

    return {
      dau,
      wau,
      mau,
      featureUsage,
      totalUsers: users.length,
      activeRate: users.length > 0 ? ((mau / users.length) * 100).toFixed(1) : '0',
    };
  }

  async getRetentionMetrics() {
    const users = await this.retryQuery(() => db.select().from(user));
    const activities = await this.retryQuery(() => db.select().from(xpActivity));

    const weeklySignups = new Map<string, string[]>();

    users.forEach(u => {
      const signupDate = new Date(u.lastLoggedIn);
      const weekKey = this.getWeekKey(signupDate);
      if (!weeklySignups.has(weekKey)) {
        weeklySignups.set(weekKey, []);
      }
      weeklySignups.get(weekKey)!.push(u.id);
    });

    const retentionData: { cohort: string; totalUsers: number; retained: number; retentionRate: string }[] = [];
    const sortedWeeks = Array.from(weeklySignups.keys()).sort().slice(-8);

    for (const weekKey of sortedWeeks) {
      const userIds = weeklySignups.get(weekKey) || [];
      const cohortStart = this.getDateFromWeekKey(weekKey);
      const oneWeekLater = new Date(cohortStart.getTime() + 7 * 24 * 60 * 60 * 1000);

      const activeUserIds = new Set(
        activities
          .filter(a => new Date(a.createdAt) >= oneWeekLater)
          .map(a => a.userId)
      );

      const retained = userIds.filter(id => activeUserIds.has(id)).length;

      retentionData.push({
        cohort: weekKey,
        totalUsers: userIds.length,
        retained,
        retentionRate: userIds.length > 0 ? ((retained / userIds.length) * 100).toFixed(1) : '0',
      });
    }

    return retentionData;
  }

  private getWeekKey(date: Date): string {
    const year = date.getFullYear();
    const weekNum = this.getWeekNumber(date);
    return `${year}-W${weekNum.toString().padStart(2, '0')}`;
  }

  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  private getDateFromWeekKey(weekKey: string): Date {
    const [yearStr, weekStr] = weekKey.split('-W');
    const year = parseInt(yearStr);
    const week = parseInt(weekStr);
    const jan1 = new Date(year, 0, 1);
    const daysOffset = (week - 1) * 7 - jan1.getDay();
    return new Date(year, 0, 1 + daysOffset);
  }

  async getContentAnalytics() {
    const [chats, users] = await this.retryQuery(() =>
      Promise.all([
        db.select().from(chat),
        db.select().from(user),
      ])
    );

    const topicCounts = new Map<string, number>();
    chats.forEach(c => {
      const topic = this.extractSimpleTopic(c.title);
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    });

    const topTopics = Array.from(topicCounts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const totalQuizzes = users.reduce((sum, u) => sum + u.quizCompleted, 0);
    const avgQuizPerUser = users.length > 0 ? (totalQuizzes / users.length).toFixed(1) : '0';

    return {
      topTopics,
      totalChats: chats.length,
      totalQuizzes,
      avgQuizPerUser,
    };
  }

  private extractSimpleTopic(title: string): string {
    const keywords = ['javascript', 'python', 'react', 'solana', 'web3', 'typescript', 'blockchain', 'crypto', 'defi', 'nft', 'rust', 'nextjs', 'nodejs'];
    const lower = title.toLowerCase();

    for (const keyword of keywords) {
      if (lower.includes(keyword)) return keyword;
    }

    const words = title.split(/\s+/).filter(w => w.length > 3);
    return words[0]?.toLowerCase() || 'other';
  }

  async getRevenueMetrics() {
    const [users, volumes] = await this.retryQuery(() =>
      Promise.all([
        db.select().from(user),
        db.select().from(totalVolumes).limit(1),
      ])
    );

    const premiumUsers = users.filter(u => u.isPremium).length;
    const totalRevenue = volumes[0]?.totalRevenue || '0.00';
    const conversionRate = users.length > 0 ? ((premiumUsers / users.length) * 100).toFixed(1) : '0';
    const arpu = users.length > 0 ? (parseFloat(totalRevenue) / users.length).toFixed(2) : '0.00';
    const arppu = premiumUsers > 0 ? (parseFloat(totalRevenue) / premiumUsers).toFixed(2) : '0.00';

    const totalReferrals = users.reduce((sum, u) => sum + (u.referralCount || 0), 0);
    const usersWithReferrals = users.filter(u => (u.referralCount || 0) > 0).length;

    return {
      totalRevenue,
      premiumUsers,
      conversionRate,
      arpu,
      arppu,
      totalReferrals,
      usersWithReferrals,
    };
  }

  async getHealthStatus() {
    try {
      await db.select().from(user).limit(1);
      return {
        status: 'healthy',
        database: { connected: true },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'down',
        database: { connected: false },
        timestamp: new Date().toISOString(),
      };
    }
  }

  async createCommunityWithAdmin(data: {
    title: string;
    inviteCode: string;
    visibility?: 'public' | 'private';
    imageUrl?: string;
    adminEmail: string;
  }) {
    const adminUser = await this.retryQuery(() =>
      db.select({ id: user.id, email: user.email, username: user.username })
        .from(user)
        .where(eq(user.username, data.adminEmail))
        .limit(1)
    );

    if (!adminUser.length) {
      throw new Error(`User with username ${data.adminEmail} not found`);
    }

    const [newCommunity] = await db
      .insert(community)
      .values({
        title: data.title,
        inviteCode: data.inviteCode,
        visibility: data.visibility || 'public',
        imageUrl: data.imageUrl,
      })
      .returning();

    await db.insert(community_members).values({
      userId: adminUser[0].id,
      communityId: newCommunity.id,
      role: 'mod',
    });

    this.logger.log(`Created community "${data.title}" with admin ${data.adminEmail}`);

    return {
      community: newCommunity,
      admin: {
        id: adminUser[0].id,
        username: adminUser[0].username,
        email: adminUser[0].email,
      },
    };
  }

  async getAllCommunities() {
    return await this.retryQuery(() =>
      db.select({
        id: community.id,
        title: community.title,
        inviteCode: community.inviteCode,
        visibility: community.visibility,
        imageUrl: community.imageUrl,
        createdAt: community.createdAt,
      }).from(community).orderBy(desc(community.createdAt))
    );
  }

  async getCommunityWithMembers(communityId: string) {
    const communityData = await this.retryQuery(() =>
      db.select().from(community).where(eq(community.id, communityId)).limit(1)
    );

    if (!communityData.length) {
      return null;
    }

    const members = await this.retryQuery(() =>
      db.select({
        id: community_members.id,
        role: community_members.role,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
        },
      })
      .from(community_members)
      .innerJoin(user, eq(community_members.userId, user.id))
      .where(eq(community_members.communityId, communityId))
    );

    return {
      ...communityData[0],
      members,
    };
  }

  async deleteCommunity(communityId: string) {
    await db.delete(community_members).where(eq(community_members.communityId, communityId));
    await db.delete(community).where(eq(community.id, communityId));
    this.logger.log(`Deleted community ${communityId}`);
    return { success: true };
  }

  async getAllFeedback() {
    return await this.retryQuery(() =>
      db.select().from(feedback).orderBy(desc(feedback.createdAt))
    );
  }
  async updateFeedbackStatus(id: string, status: 'pending' | 'reviewed' | 'resolved') {
    const updatedFeedback = await db.update(feedback).set({ status }).where(eq(feedback.id, id)).returning();
    if (!updatedFeedback.length) {
      throw new NotFoundException(`Feedback with id ${id} not found`);
    }
    return updatedFeedback[0];
  }
}


