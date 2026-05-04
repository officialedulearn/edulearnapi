export type ReminderReason =
  | 'quiz_submitted'
  | 'login'
  | 'roadmap_updated'
  | 'manual'
  | 'scheduled';

export interface ReminderEvaluateJobData {
  userId: string;
  reason: ReminderReason;
}

export interface ReminderAiDecision {
  send: boolean;
  subject?: string;
  tip?: string;
  personalizedRecap?: string;
  nextCheckInDays: number;
  why?: string;
}

export interface ReminderEvaluationResult {
  userId: string;
  reason: ReminderReason;
  send: boolean;
  blockedBy?: 'cadence_cap' | 'disabled' | 'missing_email' | 'cooldown' | 'daily_cap';
  subject?: string;
  tip?: string;
  personalizedRecap?: string;
  nextCheckAt: Date;
  why?: string;
}
