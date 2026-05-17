import { Injectable, Logger } from '@nestjs/common';
import db from '../../drizzle';
import {
  agent,
  publicQuizParticipation,
  roadmap,
  reminderEmailLog,
  user,
  userReminderState,
} from '../../lib/db/schema';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import {
  REMINDER_EVALUATE_JOB_NAME,
  reminderEvalJobId,
  reminderNextCheckJobId,
  REMINDER_EVAL_JOB_STUCK_MS,
  REMINDER_MAX_EMAILS_PER_USER_PER_7_DAYS,
  REMINDER_MAX_NEXT_CHECK_DAYS,
  REMINDER_MIN_NEXT_CHECK_DAYS,
} from './reminders.constants';
import type {
  ReminderEnqueueResult,
  ReminderEvaluationResult,
  ReminderReason,
} from './reminders.types';
import { ReminderBullmqService } from './reminder-bullmq.service';
import { ReminderDecisionService } from './reminder-decision.service';
import { ResendService } from 'src/resend/resend.service';

function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = String(email).trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function clampDays(n: number): number {
  if (!Number.isFinite(n)) return 7;
  return Math.max(
    REMINDER_MIN_NEXT_CHECK_DAYS,
    Math.min(REMINDER_MAX_NEXT_CHECK_DAYS, Math.floor(n)),
  );
}

function startOfUtcDay(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return x;
}

function computeTrend(points: number[]): 'improving' | 'declining' | 'flat' {
  if (points.length < 2) return 'flat';
  const first = points[points.length - 1];
  const last = points[0];
  const delta = last - first;
  if (delta >= 10) return 'improving';
  if (delta <= -10) return 'declining';
  return 'flat';
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly bullmq: ReminderBullmqService,
    private readonly decision: ReminderDecisionService,
    private readonly resendService: ResendService,
  ) {}

  async enqueueEvaluation(
    userId: string,
    reason: ReminderReason,
  ): Promise<ReminderEnqueueResult> {
    try {
      const queue = this.bullmq.getQueue();
      const jobId = reminderEvalJobId(userId);
      let staleJobRemoved = false;
      const existing = await queue.getJob(jobId);
      if (existing) {
        const jobState = await existing.getState();
        const ageMs = Date.now() - (existing.timestamp ?? 0);
        const stuckEvalJob =
          jobState === 'waiting' &&
          ageMs > REMINDER_EVAL_JOB_STUCK_MS;
        if (stuckEvalJob) {
          this.logger.warn(
            `Removing stuck reminder-eval job userId=${userId} ageMs=${ageMs} state=${jobState}`,
          );
          await existing.remove();
          staleJobRemoved = true;
        } else {
          this.logger.log(
            `enqueueEvaluation skip userId=${userId} reason=${reason} jobState=${jobState}`,
          );
          return { enqueued: false, reason: 'already_queued', jobState };
        }
      }

      await queue.add(
        REMINDER_EVALUATE_JOB_NAME,
        { userId, reason },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 1,
        },
      );
      const out: ReminderEnqueueResult = staleJobRemoved
        ? { enqueued: true, staleJobRemoved: true }
        : { enqueued: true };
      this.logger.log(
        `enqueueEvaluation enqueued userId=${userId} reason=${reason} staleJobRemoved=${staleJobRemoved}`,
      );
      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `enqueueEvaluation failed userId=${userId} reason=${reason}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      return { enqueued: false, reason: 'queue_error', message };
    }
  }

  async scheduleNextCheck(userId: string, nextCheckAt: Date) {
    try {
      const queue = this.bullmq.getQueue();
      const jobId = reminderNextCheckJobId(userId);
      const existing = await queue.getJob(jobId);
      if (existing) {
        try {
          await existing.remove();
        } catch {
          /* best-effort */
        }
      }
      const delay = Math.max(0, nextCheckAt.getTime() - Date.now());
      await queue.add(
        REMINDER_EVALUATE_JOB_NAME,
        { userId, reason: 'scheduled' },
        {
          jobId,
          delay,
          removeOnComplete: true,
          removeOnFail: true,
          attempts: 1,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `scheduleNextCheck failed userId=${userId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    }
  }

  async setReminderDisabled(userId: string, disabled: boolean, reason?: string) {
    const existing = await this.getReminderState(userId);
    if (existing) {
      await db
        .update(userReminderState)
        .set({
          disabled,
          disabledReason: disabled ? reason?.trim() || 'disabled' : null,
          updatedAt: new Date(),
        })
        .where(eq(userReminderState.userId, userId));
    } else {
      await db.insert(userReminderState).values({
        userId,
        disabled,
        disabledReason: disabled ? reason?.trim() || 'disabled' : null,
        updatedAt: new Date(),
      });
    }
    return this.getReminderState(userId);
  }

  async getReminderState(userId: string) {
    const [row] = await db
      .select()
      .from(userReminderState)
      .where(eq(userReminderState.userId, userId))
      .limit(1);
    return row ?? null;
  }

  async evaluateUser(params: {
    userId: string;
    reason: ReminderReason;
    dryRun?: boolean;
  }): Promise<ReminderEvaluationResult> {
    const { userId, reason, dryRun } = params;
    const now = new Date();
    this.logger.log(
      `evaluateUser start userId=${userId} reason=${reason} dryRun=${Boolean(dryRun)}`,
    );

    const [u] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!u) {
      throw new Error(`RemindersService: user ${userId} not found`);
    }

    const emailOk = isValidEmail(u.email);
    const state = await this.getReminderState(userId);

    const ensureState = async () => {
      if (state) return;
      await db.insert(userReminderState).values({
        userId,
        updatedAt: now,
      });
    };
    await ensureState();

    const nextCheckAtDefault = new Date(now);
    nextCheckAtDefault.setUTCDate(nextCheckAtDefault.getUTCDate() + 7);

    if (!emailOk) {
      if (!dryRun) {
        await this.upsertState(userId, {
          lastEvaluationAt: now,
          nextCheckAt: nextCheckAtDefault,
        });
        await this.scheduleNextCheck(userId, nextCheckAtDefault);
        await this.logDecision({
          userId,
          reason,
          decision: 'skipped',
          nextCheckAt: nextCheckAtDefault,
          why: 'Missing/invalid email',
          featuresUsed: { emailOk: false },
        });
      }
      return {
        userId,
        reason,
        send: false,
        blockedBy: 'missing_email',
        nextCheckAt: nextCheckAtDefault,
        why: 'Missing/invalid email',
      };
    }

    if (state?.disabled) {
      const nextCheckAt = nextCheckAtDefault;
      if (!dryRun) {
        await this.upsertState(userId, {
          lastEvaluationAt: now,
          nextCheckAt,
        });
        await this.scheduleNextCheck(userId, nextCheckAt);
        await this.logDecision({
          userId,
          reason,
          decision: 'skipped',
          nextCheckAt,
          why: state.disabledReason || 'disabled',
          featuresUsed: { disabled: true },
        });
      }
      return {
        userId,
        reason,
        send: false,
        blockedBy: 'disabled',
        nextCheckAt,
        why: state.disabledReason || 'disabled',
      };
    }

    if (state?.cooldownUntil && new Date(state.cooldownUntil) > now) {
      const nextCheckAt = new Date(state.cooldownUntil);
      if (!dryRun) {
        await this.upsertState(userId, {
          lastEvaluationAt: now,
          nextCheckAt,
        });
        await this.scheduleNextCheck(userId, nextCheckAt);
        await this.logDecision({
          userId,
          reason,
          decision: 'skipped',
          nextCheckAt,
          why: 'cooldown',
          featuresUsed: { cooldown: true },
        });
      }
      return {
        userId,
        reason,
        send: false,
        blockedBy: 'cooldown',
        nextCheckAt,
        why: 'cooldown',
      };
    }

    const cadenceBlocked = await this.isCadenceBlocked(userId, now);
    const dailyCapBlocked = await this.isDailyCapReached(now);

    // Load goal context.
    const [a] = await db
      .select()
      .from(agent)
      .where(eq(agent.userId, userId))
      .limit(1);
    const latestRoadmap = await db
      .select()
      .from(roadmap)
      .where(eq(roadmap.userId, userId))
      .orderBy(desc(roadmap.createdAt))
      .limit(1)
      .then((r) => r[0] ?? null);
    const goalText =
      (a?.purpose || '').trim() ||
      (u.learning || '').trim() ||
      [latestRoadmap?.topic, latestRoadmap?.title].filter(Boolean).join(' — ') ||
      'general learning';

    // Load quiz performance.
    const attempts = await db
      .select({
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
      .limit(5);

    const rows = attempts
      .filter((x) => x.score != null && x.totalQuestions != null)
      .map((x) => ({
        score: Number(x.score ?? 0),
        total: Number(x.totalQuestions ?? 0),
      }))
      .filter((x) => x.total > 0);

    const percents = rows.map((r) => Math.round((r.score / r.total) * 100));
    const trend = computeTrend(percents);
    const recentQuizSummary =
      rows.length > 0
        ? `Last ${rows.length} quizzes: ${rows
            .map((r) => `${r.score}/${r.total}`)
            .join(', ')} (${trend}).`
        : 'No recent quiz attempts yet.';

    const featuresUsed = {
      goalSource: a?.purpose
        ? 'agent.purpose'
        : u.learning
          ? 'user.learning'
          : latestRoadmap
            ? 'roadmap'
            : 'default',
      hasQuizHistory: rows.length > 0,
      trend,
    };

    // If cadence cap or daily cap blocks sending, we still call AI to set nextCheckInDays,
    // but we will force send=false.
    let aiDecision: any = null;
    let modelMeta: any = null;
    try {
      const { decision, modelMeta: mm } = await this.decision.decide({
        goalText,
        userName: u.name,
        userLevel: u.level,
        recentQuizSummary,
        hasQuizHistory: rows.length > 0,
        agentName: a?.name ?? null,
        agentPurpose: a?.purpose ?? null,
      });
      aiDecision = decision;
      modelMeta = mm;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`AI reminder decision failed for ${userId}: ${msg}`);
      aiDecision = { send: false, nextCheckInDays: 7, why: 'ai_error' };
      modelMeta = { error: msg };
    }

    const nextCheckInDays = clampDays(aiDecision.nextCheckInDays ?? 7);
    const nextCheckAt = new Date(now);
    nextCheckAt.setUTCDate(nextCheckAt.getUTCDate() + nextCheckInDays);

    const blockedBy = cadenceBlocked
      ? 'cadence_cap'
      : dailyCapBlocked
        ? 'daily_cap'
        : undefined;

    const sendRequested = Boolean(aiDecision.send);
    const sendAllowed = sendRequested && !blockedBy;

    this.logger.log(
      `evaluateUser decision userId=${userId} sendRequested=${sendRequested} sendAllowed=${sendAllowed} blockedBy=${blockedBy ?? 'none'} nextCheckInDays=${nextCheckInDays}`,
    );

    const subject = sendAllowed ? String(aiDecision.subject || '').trim() : '';
    const tip = sendAllowed ? String(aiDecision.tip || '').trim() : '';
    const personalizedRecap = sendAllowed
      ? String(aiDecision.personalizedRecap || '').trim()
      : '';

    const result: ReminderEvaluationResult = {
      userId,
      reason,
      send: sendAllowed,
      blockedBy,
      subject: sendAllowed ? subject : undefined,
      tip: sendAllowed ? tip : undefined,
      personalizedRecap: sendAllowed ? personalizedRecap : undefined,
      nextCheckAt,
      why: aiDecision.why || aiDecision.why === '' ? aiDecision.why : undefined,
    };

    if (dryRun) return result;

    // Persist + schedule next check.
    await this.upsertState(userId, {
      lastEvaluationAt: now,
      nextCheckAt,
      updatedAt: now,
    });
    await this.scheduleNextCheck(userId, nextCheckAt);

    if (!sendAllowed) {
      await this.logDecision({
        userId,
        reason,
        decision: 'skipped',
        nextCheckAt,
        subject: sendRequested ? aiDecision.subject : undefined,
        tip: sendRequested ? aiDecision.tip : undefined,
        personalizedRecap: sendRequested ? aiDecision.personalizedRecap : undefined,
        why: blockedBy || aiDecision.why || 'skipped',
        modelMeta,
        featuresUsed,
      });
      return result;
    }

    // Send email.
    const safeSubject =
      subject && subject.length <= 60 ? subject : 'Quick learning check-in';
    try {
      const sendResult = await this.resendService.sendAgentReminderEmail({
        to: u.email,
        name: u.name,
        subject: safeSubject,
        personalizedRecap,
        tip,
        goalText,
        agentName: a?.name ?? undefined,
        agentProfilePictureUrl: a?.profile_picture_url ?? undefined,
      });

      await this.upsertState(userId, {
        lastSentAt: now,
        lastEmailId: sendResult?.id ?? null,
        lastEmailSubject: safeSubject,
        updatedAt: now,
      });

      await this.logDecision({
        userId,
        reason,
        decision: 'sent',
        nextCheckAt,
        subject: safeSubject,
        tip,
        personalizedRecap,
        why: aiDecision.why || 'sent',
        modelMeta,
        featuresUsed: { ...featuresUsed, cadenceBlocked, dailyCapBlocked },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`sendAgentReminderEmail failed for ${userId}: ${msg}`);
      // Backoff for a week if send fails
      const backoff = new Date(now);
      backoff.setUTCDate(backoff.getUTCDate() + 7);
      await this.upsertState(userId, {
        cooldownUntil: backoff,
        updatedAt: now,
      });
      await this.logDecision({
        userId,
        reason,
        decision: 'skipped',
        nextCheckAt: backoff,
        subject: safeSubject,
        tip,
        personalizedRecap,
        why: `send_failed: ${msg}`,
        modelMeta,
        featuresUsed,
      });
      return {
        ...result,
        send: false,
        blockedBy: 'cooldown',
        nextCheckAt: backoff,
        why: `send_failed: ${msg}`,
      };
    }

    return result;
  }

  private async upsertState(
    userId: string,
    patch: Partial<typeof userReminderState.$inferInsert>,
  ) {
    const existing = await this.getReminderState(userId);
    if (existing) {
      await db
        .update(userReminderState)
        .set({ ...patch, updatedAt: patch.updatedAt ?? new Date() })
        .where(eq(userReminderState.userId, userId));
    } else {
      await db.insert(userReminderState).values({
        userId,
        ...patch,
        updatedAt: patch.updatedAt ?? new Date(),
      } as any);
    }
  }

  private async isCadenceBlocked(userId: string, now: Date): Promise<boolean> {
    const state = await this.getReminderState(userId);
    if (!state?.lastSentAt) return false;
    const last = new Date(state.lastSentAt);
    const diffMs = now.getTime() - last.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays < 7 / REMINDER_MAX_EMAILS_PER_USER_PER_7_DAYS;
  }

  private async isDailyCapReached(now: Date): Promise<boolean> {
    const capRaw = process.env.REMINDER_EMAILS_PER_DAY;
    const cap = capRaw ? Number(capRaw) : Infinity;
    if (!Number.isFinite(cap) || cap <= 0) return false;
    const start = startOfUtcDay(now);
    const rows = await db
      .select({ id: reminderEmailLog.id })
      .from(reminderEmailLog)
      .where(
        and(
          eq(reminderEmailLog.decision, 'sent'),
          gte(reminderEmailLog.createdAt, start),
        ),
      );
    return rows.length >= cap;
  }

  private async logDecision(p: {
    userId: string;
    reason: ReminderReason;
    decision: 'sent' | 'skipped';
    nextCheckAt: Date;
    subject?: string;
    tip?: string;
    personalizedRecap?: string;
    modelMeta?: any;
    featuresUsed?: any;
    why?: string;
  }) {
    await db.insert(reminderEmailLog).values({
      userId: p.userId,
      decision: p.decision,
      reason: p.reason,
      subject: p.subject,
      tip: p.tip,
      personalizedRecap: p.personalizedRecap,
      nextCheckAt: p.nextCheckAt,
      modelMeta: p.modelMeta ?? null,
      featuresUsed: p.featuresUsed ?? null,
      why: p.why ?? null,
    });
  }
}
