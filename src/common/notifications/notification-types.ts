export const NOTIFICATION_TYPES = [
  'quiz_ready',
  'roadmap_ready',
  'roadmap_step_ready',
  'mention',
  'leaderboard_update',
  'streak_warning',
  'nft_claimed',
  'agent_message',
  'system_announcement',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationMetadataMap = {
  quiz_ready: { quizId: string };
  roadmap_ready: { roadmapId: string };
  roadmap_step_ready: { roadmapId: string; stepId: string; chatId: string };
  mention: {
    communityId: string;
    messageId?: string;
    mentionedByUserId?: string;
  };
  leaderboard_update: { period?: 'daily' | 'weekly' | 'monthly' };
  streak_warning: { streakDays?: number };
  nft_claimed: { nftId: string };
  agent_message: { chatId: string; agentId: string };
  system_announcement: Record<string, never>;
};

export type NotificationMetadata = {
  [K in NotificationType]: NotificationMetadataMap[K];
}[NotificationType];

export const isValidNotificationType = (
  type: string,
): type is NotificationType =>
  (NOTIFICATION_TYPES as readonly string[]).includes(type);
