import type { User } from 'lib/db/schema';

export type ReferralLeaderboardEntry = {
  rank: number;
  user_id: string;
  display_name: string;
  username: string | null;
  profile_picture_url: string | null;
  total_referrals: number;
  total_earnings: number;
  level: User['level'];
  streak: number;
  xp: number;
  quiz_completed: number;
  highlight: string;
  is_current_user: boolean;
};

export type ReferralLeaderboardSummary = {
  spots: number;
  total_referrals: number;
  average_referrals: number;
  cutoff_referrals: number | null;
  top_referrer_name: string | null;
};

export type ReferralLeaderboardResponse = {
  leaderboard: ReferralLeaderboardEntry[];
  summary: ReferralLeaderboardSummary;
  updated_at: string;
};

export type ReferralMilestone = {
  target: number | null;
  remaining: number;
  progress_percent: number;
  label: string;
};

export type ReferralMe = {
  user_id: string;
  display_name: string;
  username: string | null;
  profile_picture_url: string | null;
  referral_code: string | null;
  total_referrals: number;
  total_earnings: number;
  rank: number;
  level: User['level'];
  streak: number;
  xp: number;
  quiz_completed: number;
  referrals_to_next_rank: number;
  referrals_to_top_5: number;
  next_milestone: ReferralMilestone;
};

export type ReferralCallToAction = {
  primary_goal:
    | 'earn_first_referral'
    | 'break_top_5'
    | 'climb_rank'
    | 'hold_rank';
  title: string;
  subtitle: string;
  share_message: string;
};

export type ReferralOverviewResponse = ReferralLeaderboardResponse & {
  me: ReferralMe;
  cta: ReferralCallToAction;
};

export type ReferralUserStatsResponse = {
  user_id: string;
  display_name: string;
  username: string | null;
  profile_picture_url: string | null;
  referral_code: string | null;
  total_referrals: number;
  total_earnings: number;
  level: User['level'];
  streak: number;
  xp: number;
  quiz_completed: number;
};

export type ReferralLeaderboardRankedRow = {
  userId: string;
  displayName: string;
  username: string | null;
  profilePictureUrl: string | null;
  referralCode: string | null;
  totalReferrals: number;
  totalEarnings: number;
  level: User['level'];
  streak: number;
  xp: number;
  quizCompleted: number;
  rank: number;
};
