export const AGENT_WAKEUP_QUEUE_NAME = 'agent-wakeup';
export const AGENT_WAKEUP_EVALUATE_JOB_NAME = 'AGENT_WAKEUP_EVALUATE';

export const agentWakeupEvalJobId = (userId: string) =>
  `agent-wakeup-eval-${userId}`;

export const AGENT_WAKEUP_MAX_MISSED_CONTEXT = 5;
export const AGENT_WAKEUP_MAX_ACTIVITY_CONTEXT = 5;
export const AGENT_WAKEUP_MAX_ROADMAP_CONTEXT = 2;

export const AGENT_WAKEUP_DEFAULT_MAX_PER_7_DAYS = 2;
export const AGENT_WAKEUP_DEFAULT_ACTIVE_DAYS = 30;
