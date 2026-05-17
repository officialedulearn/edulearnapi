export const REMINDER_QUEUE_NAME = 'reminders';
export const REMINDER_EVALUATE_JOB_NAME = 'REMINDER_EVALUATE';

export const reminderEvalJobId = (userId: string) => `reminder-eval:${userId}`;
export const reminderNextCheckJobId = (userId: string) =>
  `reminder-next-check:${userId}`;

export const REMINDER_MIN_NEXT_CHECK_DAYS = 3;
export const REMINDER_MAX_NEXT_CHECK_DAYS = 21;
export const REMINDER_MAX_EMAILS_PER_USER_PER_7_DAYS = 1;
export const REMINDER_EVAL_JOB_STUCK_MS = 10 * 60 * 1000;
