export const ENGAGEMENT_TEMPLATES = [
  'come-back-soon',
  'refer-friends',
  'streak-reminder',
  'eddy-tip',
  'referral-superstar',
] as const;

export type EngagementTemplateId = (typeof ENGAGEMENT_TEMPLATES)[number];

export const ENGAGEMENT_SUBJECTS: Record<EngagementTemplateId, string> = {
  'come-back-soon': "We miss you! Eddy's waiting 💚",
  'refer-friends': 'Refer friends, earn together 🎉',
  'streak-reminder': "Don't break your streak! 🔥",
  'eddy-tip': "Eddy's weekly tip 🐸",
  'referral-superstar': "You're a referral superstar! 🌟",
};
