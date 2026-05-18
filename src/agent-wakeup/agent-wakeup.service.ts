import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import db from '../../drizzle';
import {
  agent,
  agentWakeupLog,
  publicQuizAttemptAnswer,
  publicQuizParticipation,
  roadmap,
  user,
  xpActivity,
} from '../../lib/db/schema';
import { and, asc, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { generateUUID } from 'lib/utils';
import { ChatService } from 'src/chat/chat.service';
import { NotificationsService } from 'src/common/services/notifications.service';
import { AgentWakeupBullmqService } from './agent-wakeup-bullmq.service';
import {
  AGENT_WAKEUP_DEFAULT_ACTIVE_DAYS,
  AGENT_WAKEUP_DEFAULT_MAX_PER_7_DAYS,
  AGENT_WAKEUP_EVALUATE_JOB_NAME,
  AGENT_WAKEUP_MAX_ACTIVITY_CONTEXT,
  AGENT_WAKEUP_MAX_MISSED_CONTEXT,
  AGENT_WAKEUP_MAX_ROADMAP_CONTEXT,
  agentWakeupEvalJobId,
} from './agent-wakeup.constants';
import { AgentWakeupDecisionService } from './agent-wakeup-decision.service';
import type {
  AgentWakeupEvaluationResult,
  AgentWakeupReason,
} from './agent-wakeup.types';

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

@Injectable()
export class AgentWakeupService {
  private readonly logger = new Logger(AgentWakeupService.name);

  constructor(
    private readonly bullmq: AgentWakeupBullmqService,
    private readonly decision: AgentWakeupDecisionService,
    private readonly chatService: ChatService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron('0 0 * * 1,4', { timeZone: 'UTC' })
  async enqueueScheduledWakeups() {
    if (!this.isWakeupEnabled()) {
      this.logger.log('Agent wake-up schedule disabled by env');
      return;
    }

    const activeSince = this.getActiveSinceDate(new Date());
    const rows = await db
      .select({ userId: agent.userId })
      .from(agent)
      .innerJoin(user, eq(agent.userId, user.id))
      .where(gte(user.lastLoggedIn, activeSince));
    const uniqueUserIds = [...new Set(rows.map((row) => row.userId))];
    let enqueued = 0;
    for (const userId of uniqueUserIds) {
      const out = await this.enqueueEvaluation(userId, 'scheduled');
      if (out.enqueued) enqueued++;
    }
    this.logger.log(
      `Agent wake-up schedule complete candidates=${uniqueUserIds.length} enqueued=${enqueued}`,
    );
  }

  async enqueueEvaluation(userId: string, reason: AgentWakeupReason) {
    const queue = this.bullmq.getQueue();
    const jobId = agentWakeupEvalJobId(userId);
    const existing = await queue.getJob(jobId);
    if (existing) {
      const jobState = await existing.getState();
      return { enqueued: false, reason: 'already_queued' as const, jobState };
    }
    await queue.add(
      AGENT_WAKEUP_EVALUATE_JOB_NAME,
      { userId, reason },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      },
    );
    return { enqueued: true as const };
  }

  async previewUser(userId: string): Promise<AgentWakeupEvaluationResult> {
    return this.evaluateUser({
      userId,
      reason: 'manual',
      dryRun: true,
    });
  }

  async evaluateNow(userId: string): Promise<AgentWakeupEvaluationResult> {
    return this.evaluateUser({
      userId,
      reason: 'manual',
      dryRun: false,
    });
  }

  async evaluateUser(params: {
    userId: string;
    reason: AgentWakeupReason;
    dryRun?: boolean;
  }): Promise<AgentWakeupEvaluationResult> {
    const { userId, reason, dryRun } = params;
    const now = new Date();

    if (!this.isWakeupEnabled()) {
      return {
        userId,
        reason,
        sent: false,
        blockedBy: 'disabled_by_env',
        why: 'disabled_by_env',
      };
    }

    const [u] = await db
      .select({
        id: user.id,
        name: user.name,
        level: user.level,
        learning: user.learning,
        memory: user.memory,
        lastLoggedIn: user.lastLoggedIn,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!u) {
      return {
        userId,
        reason,
        sent: false,
        blockedBy: 'user_not_found',
        why: 'user_not_found',
      };
    }

    if (reason === 'scheduled' && !this.isActiveUser(u.lastLoggedIn, now)) {
      const result: AgentWakeupEvaluationResult = {
        userId,
        reason,
        sent: false,
        blockedBy: 'inactive_user',
        why: 'inactive_user',
      };
      if (!dryRun) {
        await this.logWakeup({
          userId,
          agentId: null,
          decision: 'skipped',
          reason: 'inactive_user',
          why: 'inactive_user',
        });
      }
      return result;
    }

    const [a] = await db
      .select()
      .from(agent)
      .where(eq(agent.userId, userId))
      .limit(1);
    if (!a) {
      const result: AgentWakeupEvaluationResult = {
        userId,
        reason,
        sent: false,
        blockedBy: 'no_agent',
        why: 'no_agent',
      };
      if (!dryRun) {
        await this.logWakeup({
          userId,
          agentId: null,
          decision: 'skipped',
          reason: 'no_agent',
          why: 'no_agent',
        });
      }
      return result;
    }

    const maxPer7Days = this.getMaxPer7Days();
    const sent7d = await this.countSentInRollingWindow(userId, now);
    if (sent7d >= maxPer7Days) {
      const result: AgentWakeupEvaluationResult = {
        userId,
        reason,
        sent: false,
        blockedBy: 'weekly_cap',
        why: `weekly_cap:${maxPer7Days}`,
      };
      if (!dryRun) {
        await this.logWakeup({
          userId,
          agentId: a.id,
          decision: 'skipped',
          reason: 'weekly_cap',
          why: `weekly_cap:${maxPer7Days}`,
        });
      }
      return result;
    }

    if (await this.isDailyCapReached(now)) {
      const result: AgentWakeupEvaluationResult = {
        userId,
        reason,
        sent: false,
        blockedBy: 'daily_cap',
        why: 'daily_cap',
      };
      if (!dryRun) {
        await this.logWakeup({
          userId,
          agentId: a.id,
          decision: 'skipped',
          reason: 'daily_cap',
          why: 'daily_cap',
        });
      }
      return result;
    }

    const [activities, recentRoadmaps, latestQuizAttempt] = await Promise.all([
      db
        .select({
          title: xpActivity.title,
          type: xpActivity.type,
          xpEarned: xpActivity.xpEarned,
          createdAt: xpActivity.createdAt,
        })
        .from(xpActivity)
        .where(eq(xpActivity.userId, userId))
        .orderBy(desc(xpActivity.createdAt))
        .limit(AGENT_WAKEUP_MAX_ACTIVITY_CONTEXT),
      db
        .select({
          topic: roadmap.topic,
          title: roadmap.title,
          description: roadmap.description,
        })
        .from(roadmap)
        .where(eq(roadmap.userId, userId))
        .orderBy(desc(roadmap.createdAt))
        .limit(AGENT_WAKEUP_MAX_ROADMAP_CONTEXT),
      db
        .select({
          id: publicQuizParticipation.id,
          score: publicQuizParticipation.score,
          totalQuestions: publicQuizParticipation.totalQuestions,
          submittedAt: publicQuizParticipation.submittedAt,
        })
        .from(publicQuizParticipation)
        .where(
          and(
            eq(publicQuizParticipation.userId, userId),
            isNotNull(publicQuizParticipation.submittedAt),
          ),
        )
        .orderBy(desc(publicQuizParticipation.submittedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ]);

    const missedQuestions = latestQuizAttempt
      ? await db
          .select({
            question: publicQuizAttemptAnswer.question,
            explanation: publicQuizAttemptAnswer.explanation,
            questionIndex: publicQuizAttemptAnswer.questionIndex,
          })
          .from(publicQuizAttemptAnswer)
          .where(
            and(
              eq(publicQuizAttemptAnswer.participationId, latestQuizAttempt.id),
              eq(publicQuizAttemptAnswer.isCorrect, false),
            ),
          )
          .orderBy(asc(publicQuizAttemptAnswer.questionIndex))
          .limit(AGENT_WAKEUP_MAX_MISSED_CONTEXT)
      : [];

    const recentActivities = activities.map((x) => {
      const title = (x.title || x.type || 'activity').trim();
      return `${title} (${x.type}, +${x.xpEarned} XP)`;
    });

    const lastQuizSummary = latestQuizAttempt
      ? `${latestQuizAttempt.score ?? 0}/${latestQuizAttempt.totalQuestions ?? 0} on ${latestQuizAttempt.submittedAt?.toISOString() ?? 'unknown time'}`
      : undefined;

    let messageDecision:
      | {
          chatTitle: string;
          messageText: string;
          why?: string;
        }
      | null = null;
    let modelMeta: any = null;

    try {
      const out = await this.decision.decide({
        agentName: a.name,
        agentPurpose: a.purpose,
        userName: u.name,
        userLevel: u.level ?? 'novice',
        userLearning: u.learning ?? '',
        userMemory: u.memory ?? '',
        recentActivities,
        recentRoadmaps: recentRoadmaps.map((r) => ({
          topic: r.topic,
          title: r.title,
          description: r.description,
        })),
        lastQuizSummary,
        missedQuestions: missedQuestions.map((m) => ({
          question: m.question,
          explanation: m.explanation,
        })),
      });
      messageDecision = out.decision;
      modelMeta = out.modelMeta;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Agent wake-up decision failed userId=${userId}: ${errMsg}`);
      const fallbackTip = (u.memory || a.purpose || 'Keep learning consistently.')
        .split('\n')
        .find((line) => line.trim().length > 0)
        ?.trim();
      messageDecision = {
        chatTitle: `${a.name} check-in`,
        messageText:
          missedQuestions.length > 0
            ? `I checked your last quiz and noticed a few weak spots. Focus on the missed concepts first, then retake a short quiz to lock them in.\n\nNext action: review one missed question now and explain it back in your own words.`
            : `Quick tip based on your current learning path: ${fallbackTip || 'Focus on one concept and practice it with one concrete example today.'}\n\nNext action: spend 10 minutes on one concept, then test yourself with a short question.`,
        why: 'fallback_generation',
      };
      modelMeta = { error: errMsg, fallback: true };
    }

    const result: AgentWakeupEvaluationResult = {
      userId,
      reason,
      sent: true,
      why: messageDecision.why,
    };

    if (dryRun) return result;

    const chatRecord = await this.chatService.createChat({
      title: messageDecision.chatTitle,
      userId,
    });

    await this.chatService.saveMessages({
      messages: [
        {
          id: generateUUID(),
          role: 'assistant',
          content: { text: messageDecision.messageText },
          createdAt: new Date(),
          chatId: chatRecord.id,
        } as any,
      ],
    });

    await this.notificationsService.createNotification(
      {
        userId,
        title: `${a.name} sent you a message`,
        content: 'Open your agent chat to continue learning.',
        type: 'agent_message',
        metadata: {
          chatId: chatRecord.id,
          agentId: a.id,
        },
        data: {
          screen: 'chat',
          id: chatRecord.id,
          chatId: chatRecord.id,
          agentId: a.id,
          url: `edulearnv2://chat/${chatRecord.id}`,
        },
      },
      true,
    );

    await this.logWakeup({
      userId,
      agentId: a.id,
      chatId: chatRecord.id,
      decision: 'sent',
      reason,
      why: messageDecision.why || 'sent',
      modelMeta,
      featuresUsed: {
        missedQuestionCount: missedQuestions.length,
        hasQuizHistory: Boolean(latestQuizAttempt),
        roadmapCount: recentRoadmaps.length,
        activityCount: recentActivities.length,
      },
    });

    result.chatId = chatRecord.id;
    return result;
  }

  private isWakeupEnabled(): boolean {
    const raw = String(process.env.AGENT_WAKEUP_ENABLED ?? 'true')
      .trim()
      .toLowerCase();
    return !['0', 'false', 'no', 'off'].includes(raw);
  }

  private getMaxPer7Days(): number {
    const raw = Number(process.env.AGENT_WAKEUP_MAX_PER_7_DAYS);
    if (!Number.isFinite(raw) || raw < 1) {
      return AGENT_WAKEUP_DEFAULT_MAX_PER_7_DAYS;
    }
    return Math.floor(raw);
  }

  private getActiveWindowDays(): number {
    const raw = Number(process.env.AGENT_WAKEUP_ACTIVE_DAYS);
    if (!Number.isFinite(raw) || raw < 1) {
      return AGENT_WAKEUP_DEFAULT_ACTIVE_DAYS;
    }
    return Math.floor(raw);
  }

  private getActiveSinceDate(now: Date): Date {
    const activeDays = this.getActiveWindowDays();
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - activeDays);
    return cutoff;
  }

  private isActiveUser(lastLoggedIn: Date | null, now: Date): boolean {
    if (!lastLoggedIn) return false;
    return new Date(lastLoggedIn).getTime() >= this.getActiveSinceDate(now).getTime();
  }

  private async countSentInRollingWindow(userId: string, now: Date) {
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - 7);
    const rows = await db
      .select({ id: agentWakeupLog.id })
      .from(agentWakeupLog)
      .where(
        and(
          eq(agentWakeupLog.userId, userId),
          eq(agentWakeupLog.decision, 'sent'),
          gte(agentWakeupLog.createdAt, start),
        ),
      );
    return rows.length;
  }

  private async isDailyCapReached(now: Date): Promise<boolean> {
    const capRaw = process.env.AGENT_WAKEUP_DAILY_CAP;
    const cap = capRaw ? Number(capRaw) : Infinity;
    if (!Number.isFinite(cap) || cap <= 0) return false;
    const dayStart = startOfUtcDay(now);
    const rows = await db
      .select({ id: agentWakeupLog.id })
      .from(agentWakeupLog)
      .where(
        and(
          eq(agentWakeupLog.decision, 'sent'),
          gte(agentWakeupLog.createdAt, dayStart),
        ),
      );
    return rows.length >= cap;
  }

  private async logWakeup(params: {
    userId: string;
    agentId: string | null;
    chatId?: string;
    decision: 'sent' | 'skipped';
    reason: string;
    why?: string;
    modelMeta?: any;
    featuresUsed?: any;
  }) {
    await db.insert(agentWakeupLog).values({
      userId: params.userId,
      agentId: params.agentId ?? null,
      chatId: params.chatId ?? null,
      decision: params.decision,
      reason: params.reason,
      why: params.why ?? null,
      modelMeta: params.modelMeta ?? null,
      featuresUsed: params.featuresUsed ?? null,
    });
  }
}
