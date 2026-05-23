import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql, eq, gte, lte, and, or, desc, count } from 'drizzle-orm';
import db from '../../drizzle';
import {
  user,
  xpActivity,
  reward,
  userReward,
  premiumTransactions,
  totalVolumes,
  chat,
  roadmap,
  publicQuiz,
  publicQuizParticipation,
  publicQuizAttemptAnswer,
  community,
  community_members,
  feedback,
  notifications,
  userSubscription,
  reminderEmailLog,
  agentWakeupLog,
} from '../../lib/db/schema';
import { NotificationsService } from '../common/services/notifications.service';
import { ResendService } from '../resend/resend.service';
import { RemindersService } from '../reminders/reminders.service';
import { AgentWakeupService } from 'src/agent-wakeup/agent-wakeup.service';
import {
  NFT_LISTING_BROADCAST_DATA,
  type NftListingBroadcastData,
} from '../emails/nft-listing-announcement.config';
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

export interface GrowthScoreBreakdown {
  recency: number;
  engagement: number;
  learningDepth: number;
  referral: number;
  streak: number;
  premiumSignal: number;
}

export interface GrowthLead {
  id: string;
  name: string;
  email: string;
  username: string | null;
  level: string;
  xp: number;
  streak: number;
  quizCompleted: number;
  isPremium: boolean | null;
  referralCount: number;
  lastLoggedIn: string;
  daysSinceLogin: number;
  leadScore: number;
  churnRisk: number;
  segment: string;
  componentScores: GrowthScoreBreakdown;
  signals: string[];
  recommendedAction: string;
  recommendedHref: string;
}

export interface GrowthSegment {
  id: string;
  label: string;
  description: string;
  count: number;
  percentage: number;
  severity: 'success' | 'info' | 'warning' | 'danger';
  actionHref: string;
}

export interface GrowthActionItem {
  id: string;
  title: string;
  description: string;
  count: number;
  priority: 'high' | 'medium' | 'low';
  href: string;
  actionLabel: string;
}

export interface GrowthTopic {
  topic: string;
  count: number;
  source: 'chat' | 'roadmap' | 'quiz' | 'mixed';
  trend: 'up' | 'flat' | 'down';
}

export interface GrowthRetention {
  summary: {
    activeToday: number;
    active7Days: number;
    active30Days: number;
    inactive7Days: number;
    inactive30Days: number;
    d1Rate: number;
    d7Rate: number;
    d30Rate: number;
  };
  riskBuckets: {
    label: string;
    count: number;
    description: string;
    severity: 'success' | 'info' | 'warning' | 'danger';
  }[];
  cohorts: {
    cohort: string;
    users: number;
    activeToday: number;
    active7Days: number;
    active30Days: number;
  }[];
}

export interface GrowthContentIntelligence {
  topTopics: GrowthTopic[];
  sourceBreakdown: {
    chats: number;
    roadmaps: number;
    publicQuizzes: number;
    quizAttempts: number;
    incorrectAnswers: number;
  };
  weakQuizAreas: {
    topic: string;
    incorrectAnswers: number;
    totalAnswers: number;
    missRate: number;
  }[];
}

export interface GrowthOverview {
  generatedAt: string;
  kpis: {
    label: string;
    value: number | string;
    detail: string;
    tone: 'success' | 'info' | 'warning' | 'danger';
  }[];
  segments: GrowthSegment[];
  topLeads: GrowthLead[];
  actionItems: GrowthActionItem[];
  topTopics: GrowthTopic[];
  retention: GrowthRetention['summary'];
}

interface GrowthDataSet {
  users: (typeof user.$inferSelect)[];
  activities: (typeof xpActivity.$inferSelect)[];
  chats: (typeof chat.$inferSelect)[];
  roadmaps: (typeof roadmap.$inferSelect)[];
  quizParticipations: (typeof publicQuizParticipation.$inferSelect)[];
  quizAnswers: (typeof publicQuizAttemptAnswer.$inferSelect)[];
  publicQuizzes: (typeof publicQuiz.$inferSelect)[];
  communityMembers: (typeof community_members.$inferSelect)[];
  notificationRows: (typeof notifications.$inferSelect)[];
  transactions: (typeof premiumTransactions.$inferSelect)[];
  subscriptions: (typeof userSubscription.$inferSelect)[];
  feedbackRows: (typeof feedback.$inferSelect)[];
  reminderLogs: (typeof reminderEmailLog.$inferSelect)[];
  wakeupLogs: (typeof agentWakeupLog.$inferSelect)[];
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly resendService: ResendService,
    private readonly expoPushService: ExpoPushService,
    private readonly remindersService: RemindersService,
    private readonly agentWakeupService: AgentWakeupService,
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
          this.logger.warn(
            `Database connection error, retrying... (${i + 1}/${retries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Query failed after retries');
  }

  private clampScore(value: number, max = 100): number {
    return Math.max(0, Math.min(max, Math.round(value)));
  }

  private percentage(part: number, total: number): number {
    return total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;
  }

  private daysSince(date: Date | string | null | undefined, now = new Date()) {
    if (!date) return 999;
    const value = new Date(date).getTime();
    if (Number.isNaN(value)) return 999;
    return Math.max(0, Math.floor((now.getTime() - value) / 86_400_000));
  }

  private incrementMap(map: Map<string, number>, key: string, amount = 1) {
    map.set(key, (map.get(key) || 0) + amount);
  }

  private normalizeTopic(value: string | null | undefined): string {
    const fallback = 'other';
    if (!value?.trim()) return fallback;
    const keywords = [
      'javascript',
      'python',
      'react',
      'solana',
      'web3',
      'typescript',
      'blockchain',
      'crypto',
      'defi',
      'nft',
      'rust',
      'nextjs',
      'nodejs',
      'ai',
      'wallet',
      'trading',
      'community',
    ];
    const lower = value.toLowerCase();
    const keyword = keywords.find((item) => lower.includes(item));
    if (keyword) return keyword;
    return (
      lower
        .replace(/[^a-z0-9\s-]/g, '')
        .split(/\s+/)
        .find((word) => word.length > 3) || fallback
    );
  }

  private async getGrowthDataSet(): Promise<GrowthDataSet> {
    const [
      users,
      activities,
      chats,
      roadmaps,
      quizParticipations,
      quizAnswers,
      publicQuizzes,
      communityMembers,
      notificationRows,
      transactions,
      subscriptions,
      feedbackRows,
      reminderLogs,
      wakeupLogs,
    ] = await this.retryQuery(() =>
      Promise.all([
        db.select().from(user),
        db.select().from(xpActivity),
        db.select().from(chat),
        db.select().from(roadmap),
        db.select().from(publicQuizParticipation),
        db.select().from(publicQuizAttemptAnswer),
        db.select().from(publicQuiz),
        db.select().from(community_members),
        db.select().from(notifications),
        db.select().from(premiumTransactions),
        db.select().from(userSubscription),
        db.select().from(feedback),
        db.select().from(reminderEmailLog),
        db.select().from(agentWakeupLog),
      ]),
    );

    return {
      users,
      activities,
      chats,
      roadmaps,
      quizParticipations,
      quizAnswers,
      publicQuizzes,
      communityMembers,
      notificationRows,
      transactions,
      subscriptions,
      feedbackRows,
      reminderLogs,
      wakeupLogs,
    };
  }

  private buildGrowthLeads(data: GrowthDataSet, now = new Date()): GrowthLead[] {
    const activitiesByUser = new Map<string, number>();
    const recentActivitiesByUser = new Map<string, number>();
    const chatsByUser = new Map<string, number>();
    const roadmapsByUser = new Map<string, number>();
    const communitiesByUser = new Map<string, number>();
    const notificationsByUser = new Map<string, number>();
    const transactionsByUser = new Map<string, number>();
    const subscriptionsByUser = new Map<string, number>();
    const skippedRemindersByUser = new Map<string, number>();
    const skippedWakeupsByUser = new Map<string, number>();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);

    data.activities.forEach((activity) => {
      this.incrementMap(activitiesByUser, activity.userId);
      if (new Date(activity.createdAt) >= sevenDaysAgo) {
        this.incrementMap(recentActivitiesByUser, activity.userId);
      }
    });
    data.chats.forEach((item) => this.incrementMap(chatsByUser, item.userId));
    data.roadmaps.forEach((item) =>
      this.incrementMap(roadmapsByUser, item.userId),
    );
    data.communityMembers.forEach((item) =>
      this.incrementMap(communitiesByUser, item.userId),
    );
    data.notificationRows.forEach((item) =>
      this.incrementMap(notificationsByUser, item.userId),
    );
    data.transactions.forEach((item) =>
      this.incrementMap(transactionsByUser, item.userId),
    );
    data.subscriptions.forEach((item) =>
      this.incrementMap(subscriptionsByUser, item.userId),
    );
    data.reminderLogs
      .filter((item) => item.decision === 'skipped')
      .forEach((item) => this.incrementMap(skippedRemindersByUser, item.userId));
    data.wakeupLogs
      .filter((item) => item.decision === 'skipped')
      .forEach((item) => this.incrementMap(skippedWakeupsByUser, item.userId));

    return data.users
      .map((u) => {
        const daysSinceLogin = this.daysSince(u.lastLoggedIn, now);
        const activityCount = activitiesByUser.get(u.id) || 0;
        const recentActivityCount = recentActivitiesByUser.get(u.id) || 0;
        const chatCount = chatsByUser.get(u.id) || 0;
        const roadmapCount = roadmapsByUser.get(u.id) || 0;
        const communityCount = communitiesByUser.get(u.id) || 0;
        const notificationCount = notificationsByUser.get(u.id) || 0;
        const transactionCount = transactionsByUser.get(u.id) || 0;
        const subscriptionCount = subscriptionsByUser.get(u.id) || 0;
        const skippedReminders = skippedRemindersByUser.get(u.id) || 0;
        const skippedWakeups = skippedWakeupsByUser.get(u.id) || 0;
        const referralCount = u.referralCount || 0;
        const quizCompleted = u.quizCompleted || 0;
        const streak = u.streak || 0;

        const componentScores: GrowthScoreBreakdown = {
          recency:
            daysSinceLogin <= 1
              ? 30
              : daysSinceLogin <= 7
                ? 24
                : daysSinceLogin <= 14
                  ? 16
                  : daysSinceLogin <= 30
                    ? 8
                    : 0,
          engagement: this.clampScore(
            activityCount * 2 + chatCount * 2 + roadmapCount * 4,
            30,
          ),
          learningDepth: this.clampScore(
            quizCompleted * 2 + roadmapCount * 4 + communityCount,
            15,
          ),
          referral: this.clampScore(referralCount * 5, 10),
          streak: this.clampScore(streak, 10),
          premiumSignal: this.clampScore(
            transactionCount * 3 + subscriptionCount * 2,
            5,
          ),
        };

        const leadScore = this.clampScore(
          Object.values(componentScores).reduce((sum, score) => sum + score, 0) -
            (u.isPremium ? 20 : 0),
        );
        const churnRisk = this.clampScore(
          (daysSinceLogin > 30
            ? 40
            : daysSinceLogin > 14
              ? 30
              : daysSinceLogin > 7
                ? 18
                : 4) +
            (recentActivityCount === 0 ? 20 : 0) +
            (roadmapCount === 0 ? 12 : 0) +
            (chatCount === 0 && quizCompleted === 0 ? 14 : 0) +
            this.clampScore(skippedReminders + skippedWakeups, 10),
        );

        const signals = [
          activityCount > 0 ? `${activityCount} learning activities` : '',
          chatCount > 0 ? `${chatCount} chats` : '',
          roadmapCount > 0 ? `${roadmapCount} roadmaps` : '',
          referralCount > 0 ? `${referralCount} referrals` : '',
          notificationCount > 0 ? `${notificationCount} notifications sent` : '',
          daysSinceLogin > 7 ? `${daysSinceLogin} days inactive` : '',
        ].filter(Boolean);

        const segment =
          churnRisk >= 70
            ? 'Churn risk'
            : !u.isPremium && leadScore >= 65
              ? 'Premium candidate'
              : referralCount > 0
                ? 'Referral lead'
                : leadScore >= 70
                  ? 'Power user'
                  : daysSinceLogin <= 7
                    ? 'Recently active'
                    : 'Needs nurture';

        const recommendedAction =
          churnRisk >= 70
            ? 'Send win-back message'
            : !u.isPremium && leadScore >= 65
              ? 'Send premium offer'
              : referralCount > 0
                ? 'Invite to referral push'
                : daysSinceLogin > 7
                  ? 'Send learning reminder'
                  : 'Keep monitoring';

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          username: u.username,
          level: u.level,
          xp: u.xp,
          streak,
          quizCompleted,
          isPremium: u.isPremium,
          referralCount,
          lastLoggedIn: new Date(u.lastLoggedIn).toISOString(),
          daysSinceLogin,
          leadScore,
          churnRisk,
          segment,
          componentScores,
          signals: signals.slice(0, 4),
          recommendedAction,
          recommendedHref:
            churnRisk >= 70 || daysSinceLogin > 7 ? '/emails' : '/notifications',
        };
      })
      .sort((a, b) => b.leadScore + b.churnRisk - (a.leadScore + a.churnRisk));
  }

  private buildGrowthSegments(leads: GrowthLead[]): GrowthSegment[] {
    const total = leads.length;
    const count = (predicate: (lead: GrowthLead) => boolean) =>
      leads.filter(predicate).length;

    const segmentInputs = [
      {
        id: 'new',
        label: 'New users',
        description: 'Logged in within the last 7 days.',
        count: count((lead) => lead.daysSinceLogin <= 7),
        severity: 'info' as const,
        actionHref: '/users',
      },
      {
        id: 'activated',
        label: 'Activated users',
        description: 'Have quizzes, chats, roadmaps, or XP activity.',
        count: count(
          (lead) =>
            lead.quizCompleted > 0 ||
            lead.componentScores.engagement > 0 ||
            lead.signals.some((signal) => signal.includes('roadmaps')),
        ),
        severity: 'success' as const,
        actionHref: '/analytics',
      },
      {
        id: 'power',
        label: 'Power users',
        description: 'High engagement, XP, streak, or referral activity.',
        count: count((lead) => lead.leadScore >= 70 && lead.churnRisk < 50),
        severity: 'success' as const,
        actionHref: '/leads',
      },
      {
        id: 'premium-candidates',
        label: 'Premium candidates',
        description: 'Engaged free users likely to convert.',
        count: count((lead) => !lead.isPremium && lead.leadScore >= 65),
        severity: 'info' as const,
        actionHref: '/leads?segment=premium',
      },
      {
        id: 'at-risk',
        label: 'At risk',
        description: 'Inactive 7-30 days or showing engagement drop.',
        count: count(
          (lead) =>
            (lead.daysSinceLogin > 7 && lead.daysSinceLogin <= 30) ||
            (lead.churnRisk >= 50 && lead.churnRisk < 75),
        ),
        severity: 'warning' as const,
        actionHref: '/retention',
      },
      {
        id: 'churned',
        label: 'Churned',
        description: 'Inactive for more than 30 days.',
        count: count((lead) => lead.daysSinceLogin > 30),
        severity: 'danger' as const,
        actionHref: '/retention?bucket=churned',
      },
      {
        id: 'referral',
        label: 'Referral leads',
        description: 'Users with referrals or strong sharing potential.',
        count: count(
          (lead) => lead.referralCount > 0 || (!lead.isPremium && lead.leadScore >= 75),
        ),
        severity: 'info' as const,
        actionHref: '/leads?segment=referral',
      },
    ];

    return segmentInputs.map((segment) => ({
      ...segment,
      percentage: this.percentage(segment.count, total),
    }));
  }

  private buildGrowthRetention(
    data: GrowthDataSet,
    leads: GrowthLead[],
    now = new Date(),
  ): GrowthRetention {
    const total = data.users.length;
    const activeToday = leads.filter((lead) => lead.daysSinceLogin <= 1).length;
    const active7Days = leads.filter((lead) => lead.daysSinceLogin <= 7).length;
    const active30Days = leads.filter((lead) => lead.daysSinceLogin <= 30).length;

    const riskBuckets = [
      {
        label: 'Healthy',
        count: leads.filter((lead) => lead.churnRisk < 35).length,
        description: 'Low churn risk and recent activity.',
        severity: 'success' as const,
      },
      {
        label: 'Needs nurture',
        count: leads.filter((lead) => lead.churnRisk >= 35 && lead.churnRisk < 60)
          .length,
        description: 'Some risk signals; good fit for reminders.',
        severity: 'info' as const,
      },
      {
        label: 'At risk',
        count: leads.filter((lead) => lead.churnRisk >= 60 && lead.churnRisk < 80)
          .length,
        description: 'High inactivity or weak learning depth.',
        severity: 'warning' as const,
      },
      {
        label: 'Win-back',
        count: leads.filter((lead) => lead.churnRisk >= 80).length,
        description: 'Prioritize reactivation campaigns.',
        severity: 'danger' as const,
      },
    ];

    const cohortMap = new Map<
      string,
      { users: number; activeToday: number; active7Days: number; active30Days: number }
    >();
    leads.forEach((lead) => {
      const date = new Date(lead.lastLoggedIn);
      const cohort = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const item = cohortMap.get(cohort) || {
        users: 0,
        activeToday: 0,
        active7Days: 0,
        active30Days: 0,
      };
      item.users++;
      if (lead.daysSinceLogin <= 1) item.activeToday++;
      if (lead.daysSinceLogin <= 7) item.active7Days++;
      if (lead.daysSinceLogin <= 30) item.active30Days++;
      cohortMap.set(cohort, item);
    });

    return {
      summary: {
        activeToday,
        active7Days,
        active30Days,
        inactive7Days: total - active7Days,
        inactive30Days: total - active30Days,
        d1Rate: this.percentage(activeToday, total),
        d7Rate: this.percentage(active7Days, total),
        d30Rate: this.percentage(active30Days, total),
      },
      riskBuckets,
      cohorts: Array.from(cohortMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-8)
        .map(([cohort, values]) => ({ cohort, ...values })),
    };
  }

  private buildContentIntelligence(data: GrowthDataSet): GrowthContentIntelligence {
    const topicMap = new Map<
      string,
      { count: number; chat: number; roadmap: number; quiz: number }
    >();

    const addTopic = (topic: string, source: 'chat' | 'roadmap' | 'quiz') => {
      const key = this.normalizeTopic(topic);
      const item = topicMap.get(key) || { count: 0, chat: 0, roadmap: 0, quiz: 0 };
      item.count++;
      item[source]++;
      topicMap.set(key, item);
    };

    data.chats.forEach((item) => addTopic(item.title, 'chat'));
    data.roadmaps.forEach((item) => addTopic(item.topic || item.title, 'roadmap'));
    data.publicQuizzes.forEach((item) => addTopic(item.title, 'quiz'));

    const topTopics = Array.from(topicMap.entries())
      .map(([topic, values]) => {
        const sources = [
          values.chat > 0 ? 'chat' : '',
          values.roadmap > 0 ? 'roadmap' : '',
          values.quiz > 0 ? 'quiz' : '',
        ].filter(Boolean);
        return {
          topic,
          count: values.count,
          source: sources.length > 1 ? ('mixed' as const) : (sources[0] as GrowthTopic['source']) || 'chat',
          trend: values.count >= 5 ? ('up' as const) : ('flat' as const),
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    const weakQuizMap = new Map<string, { total: number; incorrect: number }>();
    data.quizAnswers.forEach((answer) => {
      const topic = this.normalizeTopic(answer.question);
      const item = weakQuizMap.get(topic) || { total: 0, incorrect: 0 };
      item.total++;
      if (!answer.isCorrect) item.incorrect++;
      weakQuizMap.set(topic, item);
    });

    const weakQuizAreas = Array.from(weakQuizMap.entries())
      .map(([topic, item]) => ({
        topic,
        incorrectAnswers: item.incorrect,
        totalAnswers: item.total,
        missRate: this.percentage(item.incorrect, item.total),
      }))
      .filter((item) => item.totalAnswers >= 3)
      .sort((a, b) => b.missRate - a.missRate)
      .slice(0, 8);

    return {
      topTopics,
      sourceBreakdown: {
        chats: data.chats.length,
        roadmaps: data.roadmaps.length,
        publicQuizzes: data.publicQuizzes.length,
        quizAttempts: data.quizParticipations.length,
        incorrectAnswers: data.quizAnswers.filter((answer) => !answer.isCorrect)
          .length,
      },
      weakQuizAreas,
    };
  }

  private buildActionItems(
    leads: GrowthLead[],
    segments: GrowthSegment[],
    content: GrowthContentIntelligence,
  ): GrowthActionItem[] {
    const countSegment = (id: string) =>
      segments.find((segment) => segment.id === id)?.count || 0;
    const topTopic = content.topTopics[0];
    const weakArea = content.weakQuizAreas[0];

    return [
      {
        id: 'win-back',
        title: 'Users need win-back',
        description: 'Inactive or high churn-risk users should get a focused reminder.',
        count: countSegment('churned') + countSegment('at-risk'),
        priority: 'high',
        href: '/retention',
        actionLabel: 'Review retention',
      },
      {
        id: 'premium-ready',
        title: 'Premium-ready users',
        description: 'Engaged free users are ready for a premium education offer.',
        count: countSegment('premium-candidates'),
        priority: 'high',
        href: '/leads?segment=premium',
        actionLabel: 'Open leads',
      },
      {
        id: 'high-value-inactive',
        title: 'High-value users inactive 7+ days',
        description: 'Users with strong lead scores but recent inactivity.',
        count: leads.filter((lead) => lead.leadScore >= 65 && lead.daysSinceLogin > 7)
          .length,
        priority: 'medium',
        href: '/emails',
        actionLabel: 'Draft campaign',
      },
      {
        id: 'topic-growth',
        title: topTopic ? `${topTopic.topic} demand is leading` : 'No leading topic yet',
        description: topTopic
          ? 'Create content, roadmaps, or campaigns around the current top learning topic.'
          : 'More user activity is needed before topic recommendations become useful.',
        count: topTopic?.count || 0,
        priority: 'medium',
        href: '/content-intelligence',
        actionLabel: 'View topics',
      },
      {
        id: 'quiz-friction',
        title: weakArea ? `${weakArea.topic} quiz friction` : 'No quiz friction yet',
        description: weakArea
          ? 'High miss rates suggest learners need better explanations or onboarding.'
          : 'Quiz attempts are not deep enough yet for weak-area detection.',
        count: weakArea?.incorrectAnswers || 0,
        priority: weakArea ? 'medium' : 'low',
        href: '/content-intelligence',
        actionLabel: 'Inspect content',
      },
    ];
  }

  async getGrowthOverview(): Promise<GrowthOverview> {
    const data = await this.getGrowthDataSet();
    const leads = this.buildGrowthLeads(data);
    const segments = this.buildGrowthSegments(leads);
    const retention = this.buildGrowthRetention(data, leads);
    const content = this.buildContentIntelligence(data);
    const actionItems = this.buildActionItems(leads, segments, content);

    return {
      generatedAt: new Date().toISOString(),
      kpis: [
        {
          label: 'Active today',
          value: retention.summary.activeToday,
          detail: `${retention.summary.d1Rate}% of users`,
          tone: 'success',
        },
        {
          label: 'At-risk users',
          value:
            segments.find((segment) => segment.id === 'at-risk')?.count || 0,
          detail: 'Need nurture before churn',
          tone: 'warning',
        },
        {
          label: 'Win-back pool',
          value: segments.find((segment) => segment.id === 'churned')?.count || 0,
          detail: 'Inactive 30+ days',
          tone: 'danger',
        },
        {
          label: 'Premium leads',
          value:
            segments.find((segment) => segment.id === 'premium-candidates')
              ?.count || 0,
          detail: 'High engagement, not premium',
          tone: 'info',
        },
      ],
      segments,
      topLeads: leads.slice(0, 10),
      actionItems,
      topTopics: content.topTopics.slice(0, 6),
      retention: retention.summary,
    };
  }

  async getGrowthSegments(): Promise<GrowthSegment[]> {
    const data = await this.getGrowthDataSet();
    return this.buildGrowthSegments(this.buildGrowthLeads(data));
  }

  async getGrowthLeads(): Promise<GrowthLead[]> {
    const data = await this.getGrowthDataSet();
    return this.buildGrowthLeads(data).slice(0, 100);
  }

  async getGrowthRetention(): Promise<GrowthRetention> {
    const data = await this.getGrowthDataSet();
    const leads = this.buildGrowthLeads(data);
    return this.buildGrowthRetention(data, leads);
  }

  async getGrowthContentIntelligence(): Promise<GrowthContentIntelligence> {
    const data = await this.getGrowthDataSet();
    return this.buildContentIntelligence(data);
  }

  async getGrowthActionCenter(): Promise<GrowthActionItem[]> {
    const data = await this.getGrowthDataSet();
    const leads = this.buildGrowthLeads(data);
    const segments = this.buildGrowthSegments(leads);
    const content = this.buildContentIntelligence(data);
    return this.buildActionItems(leads, segments, content);
  }

  async getSignupStats(startDate?: Date, endDate?: Date): Promise<SignupStats> {
    const start = startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const end = endDate || new Date();

    const users = await this.retryQuery(() =>
      db
        .select({
          id: user.id,
          lastLoggedIn: user.lastLoggedIn,
        })
        .from(user),
    );

    const dailyMap = new Map<string, number>();
    const weeklyMap = new Map<string, number>();
    const monthlyMap = new Map<string, number>();

    users.forEach((u) => {
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

    const [users, activities, rewards, chats, volumes] = await this.retryQuery(
      () =>
        Promise.all([
          db.select().from(user),
          db.select().from(xpActivity),
          db.select().from(reward),
          db.select().from(chat),
          db.select().from(totalVolumes).limit(1),
        ]),
    );

    const totalUsers = users.length;
    const premiumUsers = users.filter((u) => u.isPremium).length;
    const totalXP = users.reduce((sum, u) => sum + u.xp, 0);
    const totalQuizzes = users.reduce((sum, u) => sum + u.quizCompleted, 0);

    const activeToday = users.filter(
      (u) => new Date(u.lastLoggedIn) >= oneDayAgo,
    ).length;
    const activeWeek = users.filter(
      (u) => new Date(u.lastLoggedIn) >= oneWeekAgo,
    ).length;
    const activeMonth = users.filter(
      (u) => new Date(u.lastLoggedIn) >= oneMonthAgo,
    ).length;

    return {
      totalUsers,
      premiumUsers,
      premiumConversionRate:
        totalUsers > 0 ? (premiumUsers / totalUsers) * 100 : 0,
      totalQuizzesCompleted: totalQuizzes,
      averageQuizzesPerUser:
        totalUsers > 0 ? Math.round(totalQuizzes / totalUsers) : 0,
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
      db.select().from(xpActivity).where(gte(xpActivity.createdAt, startDate)),
    );

    const trendsMap = new Map<
      string,
      { quiz: number; chat: number; streak: number }
    >();

    activities.forEach((activity) => {
      const dateKey = new Date(activity.createdAt).toISOString().split('T')[0];
      const existing = trendsMap.get(dateKey) || {
        quiz: 0,
        chat: 0,
        streak: 0,
      };

      if (activity.type === 'quiz') existing.quiz++;
      else if (activity.type === 'chat') existing.chat++;
      else if (activity.type === 'streak') existing.streak++;

      trendsMap.set(dateKey, existing);
    });

    return Array.from(trendsMap.entries())
      .map(([date, counts]) => ({ date, ...counts }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async broadcastNotification(
    title: string,
    content: string,
  ): Promise<{ sent: number; failed: number }> {
    const users = await db
      .select({
        id: user.id,
        expoPushToken: user.expoPushToken,
      })
      .from(user);

    let sent = 0;
    let failed = 0;

    for (const u of users) {
      try {
        await this.notificationsService.createNotification({
          title,
          content,
          userId: u.id,
          type: 'system_announcement',
        });
        sent++;
      } catch (error) {
        this.logger.error(`Failed to send notification to user ${u.id}`, error);
        failed++;
      }
    }

    return { sent, failed };
  }

  async sendNotificationToUsers(
    userIds: string[],
    title: string,
    content: string,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        await this.notificationsService.createNotification({
          title,
          content,
          userId,
          type: 'system_announcement',
        });
        sent++;
      } catch (error) {
        this.logger.error(
          `Failed to send notification to user ${userId}`,
          error,
        );
        failed++;
      }
    }

    return { sent, failed };
  }

  async broadcastEmail(
    subject: string,
    htmlContent: string,
  ): Promise<{ sent: number; failed: number }> {
    const htmlWithUnsubscribe = htmlContent.includes(
      '{{{RESEND_UNSUBSCRIBE_URL}}}',
    )
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

  async sendEmailToUsers(
    emails: string[],
    subject: string,
    htmlContent: string,
  ): Promise<{ sent: number; failed: number }> {
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

  async evaluateReminderNow(userId: string) {
    const result = await this.remindersService.enqueueEvaluation(userId, 'manual');
    const ok =
      result.enqueued ||
      (!result.enqueued && result.reason === 'already_queued');
    return { ok, ...result };
  }

  async previewReminder(userId: string) {
    return await this.remindersService.evaluateUser({
      userId,
      reason: 'manual',
      dryRun: true,
    });
  }

  async setReminderDisabled(userId: string, disabled: boolean, reason?: string) {
    const state = await this.remindersService.setReminderDisabled(
      userId,
      disabled,
      reason,
    );
    return { ok: true, state };
  }

  async previewAgentWakeup(userId: string) {
    return await this.agentWakeupService.previewUser(userId);
  }

  async evaluateAgentWakeupNow(userId: string) {
    return await this.agentWakeupService.evaluateNow(userId);
  }

  async broadcastV25Announcement(): Promise<{
    sent: number;
    failed: number;
    total: number;
  }> {
    try {
      return await this.resendService.broadcastV25Announcement();
    } catch (error) {
      this.logger.error('Failed to broadcast v2.5 announcement', error);
      throw error;
    }
  }

  async sendV25AnnouncementTest(
    email: string,
    name?: string,
  ): Promise<{ sent: boolean }> {
    try {
      await this.resendService.sendV25AnnouncementEmail(
        email,
        name || 'Test User',
      );
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
    const valid = [
      'come-back-soon',
      'refer-friends',
      'streak-reminder',
      'eddy-tip',
      'referral-superstar',
    ];
    if (!valid.includes(template)) {
      throw new NotFoundException(`Unknown template: ${template}`);
    }
    const html = await this.resendService.getEngagementPreviewHtml(
      template as any,
      {
        name: params.name || 'Test User',
        referralCode: params.referralCode,
        referralCount: params.referralCount,
      },
    );
    return { html };
  }

  async sendEngagementTest(
    template: string,
    email: string,
    params: { name?: string; referralCode?: string; referralCount?: number },
  ): Promise<{ sent: boolean }> {
    const valid = [
      'come-back-soon',
      'refer-friends',
      'streak-reminder',
      'eddy-tip',
      'referral-superstar',
    ];
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

  async broadcastEngagement(
    template: string,
  ): Promise<{ sent: number; failed: number; total: number }> {
    const valid = [
      'come-back-soon',
      'refer-friends',
      'streak-reminder',
      'eddy-tip',
      'referral-superstar',
    ];
    if (!valid.includes(template)) {
      throw new NotFoundException(`Unknown template: ${template}`);
    }
    return await this.resendService.broadcastEngagement(template as any);
  }

  getNftListingBroadcastConfig(): NftListingBroadcastData {
    return { ...NFT_LISTING_BROADCAST_DATA };
  }

  async getNftListingAnnouncementPreview(
    partial?: Partial<NftListingBroadcastData>,
  ): Promise<{ html: string }> {
    const html = await this.resendService.renderNftListingAnnouncementHtml(
      partial,
      false,
    );
    return { html };
  }

  async sendNftListingAnnouncementTest(
    email: string,
    partial?: Partial<NftListingBroadcastData>,
  ): Promise<{ sent: boolean }> {
    await this.resendService.sendNftListingAnnouncementTest(
      email.trim(),
      partial,
    );
    return { sent: true };
  }

  async broadcastNftListingAnnouncement(
    partial?: Partial<NftListingBroadcastData>,
  ): Promise<{ sent: number; failed: number; total: number }> {
    return await this.resendService.broadcastNftListingAnnouncement(partial);
  }

  async getAllUsersForAdmin() {
    return await this.retryQuery(() =>
      db
        .select({
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
        })
        .from(user)
        .orderBy(desc(user.lastLoggedIn)),
    );
  }

  async getEngagementMetrics() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [users, activities] = await this.retryQuery(() =>
      Promise.all([db.select().from(user), db.select().from(xpActivity)]),
    );

    const dau = users.filter(
      (u) => new Date(u.lastLoggedIn) >= oneDayAgo,
    ).length;
    const wau = users.filter(
      (u) => new Date(u.lastLoggedIn) >= sevenDaysAgo,
    ).length;
    const mau = users.filter(
      (u) => new Date(u.lastLoggedIn) >= thirtyDaysAgo,
    ).length;

    const featureUsage = {
      quiz: activities.filter((a) => a.type === 'quiz').length,
      chat: activities.filter((a) => a.type === 'chat').length,
      streak: activities.filter((a) => a.type === 'streak').length,
    };

    return {
      dau,
      wau,
      mau,
      featureUsage,
      totalUsers: users.length,
      activeRate:
        users.length > 0 ? ((mau / users.length) * 100).toFixed(1) : '0',
    };
  }

  async getRetentionMetrics() {
    const users = await this.retryQuery(() => db.select().from(user));
    const activities = await this.retryQuery(() =>
      db.select().from(xpActivity),
    );

    const weeklySignups = new Map<string, string[]>();

    users.forEach((u) => {
      const signupDate = new Date(u.lastLoggedIn);
      const weekKey = this.getWeekKey(signupDate);
      if (!weeklySignups.has(weekKey)) {
        weeklySignups.set(weekKey, []);
      }
      weeklySignups.get(weekKey)!.push(u.id);
    });

    const retentionData: {
      cohort: string;
      totalUsers: number;
      retained: number;
      retentionRate: string;
    }[] = [];
    const sortedWeeks = Array.from(weeklySignups.keys()).sort().slice(-8);

    for (const weekKey of sortedWeeks) {
      const userIds = weeklySignups.get(weekKey) || [];
      const cohortStart = this.getDateFromWeekKey(weekKey);
      const oneWeekLater = new Date(
        cohortStart.getTime() + 7 * 24 * 60 * 60 * 1000,
      );

      const activeUserIds = new Set(
        activities
          .filter((a) => new Date(a.createdAt) >= oneWeekLater)
          .map((a) => a.userId),
      );

      const retained = userIds.filter((id) => activeUserIds.has(id)).length;

      retentionData.push({
        cohort: weekKey,
        totalUsers: userIds.length,
        retained,
        retentionRate:
          userIds.length > 0
            ? ((retained / userIds.length) * 100).toFixed(1)
            : '0',
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
    const pastDaysOfYear =
      (date.getTime() - firstDayOfYear.getTime()) / 86400000;
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
      Promise.all([db.select().from(chat), db.select().from(user)]),
    );

    const topicCounts = new Map<string, number>();
    chats.forEach((c) => {
      const topic = this.extractSimpleTopic(c.title);
      topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
    });

    const topTopics = Array.from(topicCounts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const totalQuizzes = users.reduce((sum, u) => sum + u.quizCompleted, 0);
    const avgQuizPerUser =
      users.length > 0 ? (totalQuizzes / users.length).toFixed(1) : '0';

    return {
      topTopics,
      totalChats: chats.length,
      totalQuizzes,
      avgQuizPerUser,
    };
  }

  private extractSimpleTopic(title: string): string {
    const keywords = [
      'javascript',
      'python',
      'react',
      'solana',
      'web3',
      'typescript',
      'blockchain',
      'crypto',
      'defi',
      'nft',
      'rust',
      'nextjs',
      'nodejs',
    ];
    const lower = title.toLowerCase();

    for (const keyword of keywords) {
      if (lower.includes(keyword)) return keyword;
    }

    const words = title.split(/\s+/).filter((w) => w.length > 3);
    return words[0]?.toLowerCase() || 'other';
  }

  async getRevenueMetrics() {
    const [users, volumes] = await this.retryQuery(() =>
      Promise.all([
        db.select().from(user),
        db.select().from(totalVolumes).limit(1),
      ]),
    );

    const premiumUsers = users.filter((u) => u.isPremium).length;
    const totalRevenue = volumes[0]?.totalRevenue || '0.00';
    const conversionRate =
      users.length > 0 ? ((premiumUsers / users.length) * 100).toFixed(1) : '0';
    const arpu =
      users.length > 0
        ? (parseFloat(totalRevenue) / users.length).toFixed(2)
        : '0.00';
    const arppu =
      premiumUsers > 0
        ? (parseFloat(totalRevenue) / premiumUsers).toFixed(2)
        : '0.00';

    const totalReferrals = users.reduce(
      (sum, u) => sum + (u.referralCount || 0),
      0,
    );
    const usersWithReferrals = users.filter(
      (u) => (u.referralCount || 0) > 0,
    ).length;

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
      db
        .select({ id: user.id, email: user.email, username: user.username })
        .from(user)
        .where(
          or(
            eq(user.username, data.adminEmail),
            eq(user.email, data.adminEmail),
          ),
        )
        .limit(1),
    );

    if (!adminUser.length) {
      throw new Error(`User with username/email ${data.adminEmail} not found`);
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

    this.logger.log(
      `Created community "${data.title}" with admin ${data.adminEmail}`,
    );

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
      db
        .select({
          id: community.id,
          title: community.title,
          inviteCode: community.inviteCode,
          visibility: community.visibility,
          imageUrl: community.imageUrl,
          createdAt: community.createdAt,
        })
        .from(community)
        .orderBy(desc(community.createdAt)),
    );
  }

  async getCommunityWithMembers(communityId: string) {
    const communityData = await this.retryQuery(() =>
      db.select().from(community).where(eq(community.id, communityId)).limit(1),
    );

    if (!communityData.length) {
      return null;
    }

    const members = await this.retryQuery(() =>
      db
        .select({
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
        .where(eq(community_members.communityId, communityId)),
    );

    return {
      ...communityData[0],
      members,
    };
  }

  async deleteCommunity(communityId: string) {
    await db
      .delete(community_members)
      .where(eq(community_members.communityId, communityId));
    await db.delete(community).where(eq(community.id, communityId));
    this.logger.log(`Deleted community ${communityId}`);
    return { success: true };
  }

  async getAllFeedback() {
    return await this.retryQuery(() =>
      db.select().from(feedback).orderBy(desc(feedback.createdAt)),
    );
  }
  async updateFeedbackStatus(
    id: string,
    status: 'pending' | 'reviewed' | 'resolved',
  ) {
    const updatedFeedback = await db
      .update(feedback)
      .set({ status })
      .where(eq(feedback.id, id))
      .returning();
    if (!updatedFeedback.length) {
      throw new NotFoundException(`Feedback with id ${id} not found`);
    }
    return updatedFeedback[0];
  }
}
