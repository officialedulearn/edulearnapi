export type AgentWakeupReason = 'scheduled' | 'manual';

export interface AgentWakeupEvaluateJobData {
  userId: string;
  reason: AgentWakeupReason;
}

export interface AgentWakeupDecision {
  chatTitle: string;
  messageText: string;
  why?: string;
}

export interface AgentWakeupEvaluationResult {
  userId: string;
  reason: AgentWakeupReason;
  sent: boolean;
  chatId?: string;
  blockedBy?:
    | 'disabled_by_env'
    | 'no_agent'
    | 'inactive_user'
    | 'weekly_cap'
    | 'daily_cap'
    | 'user_not_found'
    | 'generation_failed';
  why?: string;
}
