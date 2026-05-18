import type { InferSelectModel } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  varchar,
  timestamp,
  json,
  uuid,
  text,
  primaryKey,
  foreignKey,
  boolean,
  integer,
  numeric,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const subscriptionTierEnum = pgEnum('subscription_tier', [
  'basic',
  'pro',
  'ultra',
]);

export const billingPeriodEnum = pgEnum('billing_period', [
  'monthly',
  'yearly',
]);

export type UserSettingsPreferences = {
  pushNotifications: boolean;
  inAppNotifications: boolean;
  emailNotifications: boolean;
  agentWake: boolean;
  memoryEnabled: boolean;
};

export const DEFAULT_USER_SETTINGS_PREFERENCES: UserSettingsPreferences = {
  pushNotifications: true,
  inAppNotifications: true,
  emailNotifications: true,
  agentWake: true,
  memoryEnabled: true,
};

const isSettingsRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

export function normalizeUserSettingsPreferences(
  value: unknown,
): UserSettingsPreferences {
  if (!isSettingsRecord(value)) {
    return { ...DEFAULT_USER_SETTINGS_PREFERENCES };
  }

  return {
    pushNotifications: readBoolean(
      value.pushNotifications,
      DEFAULT_USER_SETTINGS_PREFERENCES.pushNotifications,
    ),
    inAppNotifications: readBoolean(
      value.inAppNotifications,
      DEFAULT_USER_SETTINGS_PREFERENCES.inAppNotifications,
    ),
    emailNotifications: readBoolean(
      value.emailNotifications,
      DEFAULT_USER_SETTINGS_PREFERENCES.emailNotifications,
    ),
    agentWake: readBoolean(
      value.agentWake,
      DEFAULT_USER_SETTINGS_PREFERENCES.agentWake,
    ),
    memoryEnabled: readBoolean(
      value.memoryEnabled,
      DEFAULT_USER_SETTINGS_PREFERENCES.memoryEnabled,
    ),
  };
}

export const user = pgTable('user', {
  id: uuid('id').primaryKey().notNull(),
  address: text('address').unique(),
  xp: integer('xp').notNull().default(0),
  credits: numeric('credits', { precision: 10, scale: 2 })
    .notNull()
    .default('20'),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  lastLoggedIn: timestamp('lastLoggedIn').notNull().defaultNow(),
  streak: integer('streak').notNull().default(1),
  referralCode: text('referralCode'),
  referralCount: integer('referralCount').default(0),
  learning: text('learning'),
  referredBy: text('referredBy'),
  level: varchar('level', {
    enum: ['novice', 'beginner', 'intermediate', 'advanced', 'expert'],
  })
    .notNull()
    .default('novice'),
  username: text('username').unique(),
  quizCompleted: integer('quizCompleted').notNull().default(0),
  encryptedPrivateKey: text('encryptedPrivateKey').notNull(),
  lastCreditRenewal: timestamp('last_credit_renewal'),
  isPremium: boolean('isPremium').default(false),
  premiumUntil: timestamp('premiumUntil'),
  verified: boolean('verified').default(false),
  imageUploadLimit: integer('imageUploadLimit').default(3),
  quizLimits: integer('quizLimits').default(5),
  totalEarnings: numeric('totalEarnings', { precision: 10, scale: 2 }).default(
    '0.00',
  ),
  memory: varchar('memory', { length: 500 }).default(''),
  settingsPreferences: json('settingsPreferences')
    .$type<UserSettingsPreferences>()
    .default(
      sql`'{"pushNotifications":true,"inAppNotifications":true,"emailNotifications":true,"agentWake":true,"memoryEnabled":true}'::json`,
    ),
  expoPushToken: text('expoPushToken'),
  profilePictureURL: text('profilePictureURL'),
  oauthProvider: text('oauth_provider'),
  oauthProviderId: text('oauth_provider_id'),
  hasCompletedProfile: boolean('has_completed_profile').default(true),
  streakShieldActive: boolean('streak_shield_active').default(false),
  streakShieldExpiry: timestamp('streak_shield_expiry'),
  streakShieldPurchases: integer('streak_shield_purchases').default(0),
}, (table) => ({
  emailIdx: uniqueIndex('user_email_idx').on(table.email),
  usernameIdx: uniqueIndex('user_username_idx').on(table.username),
}));

export type User = InferSelectModel<typeof user>;

export const claim = pgTable('claim', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  wallet: text('wallet').notNull().unique(),
  claimedAt: timestamp('claimedAt').notNull().defaultNow(),
});

export type Claim = InferSelectModel<typeof claim>;

export const reward = pgTable('reward', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  type: varchar('type', { enum: ['certificate', 'points'] }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  imageUrl: text('imageUrl'),
  ipfs: text('ipfs').unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export type Reward = InferSelectModel<typeof reward>;

export const userReward = pgTable(
  'user_reward',
  {
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    rewardId: uuid('rewardId')
      .notNull()
      .references(() => reward.id),
    earnedAt: timestamp('earnedAt').notNull().defaultNow(),
    signature: text('signature').unique(),
    lockTransactionId: text('lockTransactionId'),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.userId, table.rewardId] }),
    };
  },
);

export type UserReward = InferSelectModel<typeof userReward>;

export const chat = pgTable('chat', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  createdAt: timestamp('createdAt').notNull(),
  title: text('title').notNull(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
  tested: boolean('tested').default(false),
  testLimit: integer('testLimit').default(3),
});

export type Chat = InferSelectModel<typeof chat>;

export const quiz = pgTable('quiz', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    chatId: uuid('chatId')
      .notNull()
      .references(() => chat.id),
    role: varchar('role').notNull(),
    content: json('content').notNull(),
    createdAt: timestamp('createdAt').notNull(),
  },
  (table) => ({
    messageChatIdCreatedAtIdx: index('message_chat_id_created_at_idx').on(
      table.chatId,
      table.createdAt,
    ),
  }),
);

export type Message = InferSelectModel<typeof message>;

export const xpActivity = pgTable('activity', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  type: varchar('type', { enum: ['quiz', 'chat', 'streak'] }).notNull(),
  title: text('title'),
  xpEarned: integer('xpEarned').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
}, (table) => ({
  xpActivityUserIdCreatedAtIdx: index('xp_activity_user_created_at_idx').on(
    table.userId,
    table.createdAt,
  ),
}));

export type XpActivity = InferSelectModel<typeof xpActivity>;

export const premiumTransactions = pgTable('premium_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id),
  signature: varchar('signature', { length: 256 }).notNull().unique(),
  amount: integer('amount').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type PremiumTransaction = InferSelectModel<typeof premiumTransactions>;

export const earning = pgTable('earning', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  sol: numeric('sol', { precision: 10, scale: 2 }).notNull().default('0.00'),
  edln: numeric('edln', { precision: 10, scale: 2 }).notNull().default('0.00'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export type Earning = InferSelectModel<typeof earning>;

export const roadmap = pgTable('roadmap', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  topic: text('topic').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  claimableNFT: uuid('claimableNFT')
    .references(() => reward.id)
    .default(sql`NULL`),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export type Roadmap = InferSelectModel<typeof roadmap>;

export const roadMapStep = pgTable('roadmap_step', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  roadmapId: uuid('roadmapId')
    .notNull()
    .references(() => roadmap.id),
  prompt: text('prompt').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  time: integer('time').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  done: boolean('done').default(false),
});

export const totalVolumes = pgTable('total_volumes', {
  id: integer('id').primaryKey(),
  totalRevenue: numeric('totalRevenue', { precision: 10, scale: 2 })
    .notNull()
    .default('0.00'),
  totalEdlnBurned: numeric('totalEdlnBurned', { precision: 10, scale: 2 })
    .notNull()
    .default('0.00'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export type TotalVolumes = InferSelectModel<typeof totalVolumes>;

export const community = pgTable('community', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  title: text('title').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  inviteCode: varchar('inviteCode', { length: 256 }).notNull().unique(),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
  imageUrl: text('imageUrl'),
});

export type Community = InferSelectModel<typeof community>;

export const roomMessage = pgTable(
  'room_message',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    roomId: uuid('roomId')
      .notNull()
      .references(() => community.id),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    content: text('content').notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => ({
    roomCreatedIdx: index('room_message_room_id_created_at_idx').on(
      table.roomId,
      table.createdAt,
    ),
  }),
);

export type roomMessage = InferSelectModel<typeof roomMessage>;

export const messageReaction = pgTable(
  'message_reaction',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    messageId: uuid('messageId')
      .notNull()
      .references(() => roomMessage.id),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    reaction: text('reaction').notNull(),
  },
  (table) => ({
    messageIdx: index('message_reaction_message_id_idx').on(table.messageId),
    messageUserIdx: index('message_reaction_message_id_user_id_idx').on(
      table.messageId,
      table.userId,
    ),
  }),
);

export type MessageReaction = InferSelectModel<typeof messageReaction>;

export const mention = pgTable('mention', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  messageId: uuid('messageId')
    .notNull()
    .references(() => roomMessage.id),
  mentionedUserId: uuid('mentionedUserId')
    .notNull()
    .references(() => user.id),
});

export type Mention = InferSelectModel<typeof mention>;

export const community_members = pgTable(
  'community_members',
  {
    id: uuid('id').primaryKey().defaultRandom().notNull(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    communityId: uuid('communityId')
      .notNull()
      .references(() => community.id),
    role: varchar('role', {
      enum: ['mod', 'member'],
    })
      .notNull()
      .default('member'),
  },
  (table) => ({
    communityUserIdx: index('community_members_community_id_user_id_idx').on(
      table.communityId,
      table.userId,
    ),
  }),
);

export type CommunityMembers = InferSelectModel<typeof community_members>;

export const notifications = pgTable('notifications', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  content: text('content').notNull(),
  title: text('title').notNull(),
  type: varchar('type', {
    enum: [
      'quiz_ready',
      'roadmap_ready',
      'roadmap_step_ready',
      'mention',
      'leaderboard_update',
      'streak_warning',
      'nft_claimed',
      'agent_message',
      'system_announcement',
    ],
  }).notNull().default('system_announcement'),
  read: boolean('read').default(false),
  metadata: json('metadata'),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export const community_join_request = pgTable('community_join_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  communityId: uuid('communityId')
    .notNull()
    .references(() => community.id),
  createdAt: timestamp('createdAt').defaultNow(),
  status: varchar('status', { enum: ['pending', 'approved', 'rejected'] })
    .notNull()
    .default('pending'),
});

export type CommunityJoinRequest = InferSelectModel<
  typeof community_join_request
>;

export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  content: text('content').notNull(),
  category: varchar('category', {
    enum: ['bug', 'feature', 'improvement', 'other'],
  }),
  status: varchar('status', { enum: ['pending', 'reviewed', 'resolved'] })
    .notNull()
    .default('pending'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  reviewedAt: timestamp('reviewedAt'),
  reviewedBy: uuid('reviewedBy').references(() => user.id),
});

export type Feedback = InferSelectModel<typeof feedback>;

export const userFollows = pgTable(
  'user_follows',
  {
    id: uuid('id').notNull().defaultRandom().unique(),
    followerId: uuid('followerId')
      .notNull()
      .references(() => user.id),
    followingId: uuid('followingId')
      .notNull()
      .references(() => user.id),
    emailNotifications: boolean('emailNotifications').default(true),
    pushNotifications: boolean('pushNotifications').default(true),
    inAppNotifications: boolean('inAppNotifications').default(true),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.followerId, table.followingId] }),
    };
  },
);

export type UserFollow = InferSelectModel<typeof userFollows>;

export const contentAnalytics = pgTable('content_analytics', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  topic: text('topic').notNull(),
  category: varchar('category', { length: 50 }).notNull(),
  totalViews: integer('totalViews').default(0),
  lastUpdated: timestamp('lastUpdated').notNull().defaultNow(),
});

export type ContentAnalytics = InferSelectModel<typeof contentAnalytics>;

export const weeklyLeaderboard = pgTable('weekly_leaderboard', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  weekStart: timestamp('week_start').notNull(),
  weekEnd: timestamp('week_end').notNull(),
  xpEarned: integer('xp_earned').notNull().default(0),
  rank: integer('rank'),
  prizeAwarded: boolean('prize_awarded').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type WeeklyLeaderboard = InferSelectModel<typeof weeklyLeaderboard>;

export const publicQuiz = pgTable('public_quiz', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  title: text('title').notNull(),
  description: text('description'),
  questions: json('questions').notNull(),
  createdBy: uuid('createdBy')
    .notNull()
    .references(() => user.id),
  sourceChatId: uuid('sourceChatId').references(() => chat.id),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  viewCount: integer('viewCount').notNull().default(0),
  attemptCount: integer('attemptCount').notNull().default(0),
  creatorId: uuid('creatorId').references(() => user.id),
});

export type PublicQuiz = InferSelectModel<typeof publicQuiz>;

export const publicQuizParticipation = pgTable(
  'public_quiz_participation',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    quizId: uuid('quizId')
      .notNull()
      .references(() => publicQuiz.id),
    joinedAt: timestamp('joinedAt').notNull().defaultNow(),
    submittedAt: timestamp('submittedAt'),
    score: integer('score'),
    totalQuestions: integer('totalQuestions'),
  },
  (table) => ({
    userQuizIdx: index('public_quiz_participation_user_quiz_idx').on(
      table.userId,
      table.quizId,
    ),
  }),
);

export type PublicQuizParticipation = InferSelectModel<
  typeof publicQuizParticipation
>;

export const publicQuizAttemptAnswer = pgTable(
  'public_quiz_attempt_answer',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    quizId: uuid('quizId')
      .notNull()
      .references(() => publicQuiz.id),
    participationId: uuid('participationId')
      .notNull()
      .references(() => publicQuizParticipation.id),
    questionIndex: integer('questionIndex').notNull(),
    question: text('question').notNull(),
    selectedAnswer: text('selectedAnswer').notNull(),
    correctAnswer: text('correctAnswer').notNull(),
    explanation: text('explanation').notNull(),
    isCorrect: boolean('isCorrect').notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => ({
    participationIdIdx: index(
      'public_quiz_attempt_answer_participation_id_idx',
    ).on(table.participationId),
    userSubmittedIdx: index('public_quiz_attempt_answer_user_created_at_idx').on(
      table.userId,
      table.createdAt,
    ),
  }),
);

export type PublicQuizAttemptAnswer = InferSelectModel<
  typeof publicQuizAttemptAnswer
>;

export const quizGenerationSchedule = pgTable('quiz_generation_schedule', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),

  topic: text('topic').notNull(),
  difficulty: varchar('difficulty', {
    enum: ['easy', 'medium', 'hard'],
  }).notNull(),
  cronExpression: text('cronExpression').notNull(),
  timeZone: text('timeZone').notNull().default('UTC'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
});

export type QuizGenerationSchedule = InferSelectModel<
  typeof quizGenerationSchedule
>;

export const flashcardDeck = pgTable(
  'flashcard_deck',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    title: text('title').notNull(),
    topic: text('topic').notNull(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt'),
  },
  (table) => ({
    userIdIdx: index('flashcard_deck_user_id_idx').on(table.userId),
    userCreatedIdx: index('flashcard_deck_user_id_created_at_idx').on(
      table.userId,
      table.createdAt,
    ),
  }),
);

export type FlashcardDeck = InferSelectModel<typeof flashcardDeck>;

export const flashcard = pgTable('flashcard', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  deckId: uuid('deckId')
    .notNull()
    .references(() => flashcardDeck.id, { onDelete: 'cascade' }),
  front: text('front').notNull(),
  back: text('back').notNull(),
  sortOrder: integer('sortOrder').notNull(),
});

export const trends = pgTable('trends', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  tags: text('tags').array().notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export type Trends = InferSelectModel<typeof trends>;
export type Flashcard = InferSelectModel<typeof flashcard>;


export const agent = pgTable('agent', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  name: text('name').notNull(),
  purpose: text('purpose').notNull(),
  profile_picture_url: text('profile_picture_url'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export type Agent = InferSelectModel<typeof agent>;

export const userReminderState = pgTable(
  'user_reminder_state',
  {
    userId: uuid('userId')
      .notNull()
      .references(() => user.id)
      .unique(),
    nextCheckAt: timestamp('nextCheckAt'),
    lastSentAt: timestamp('lastSentAt'),
    lastEvaluationAt: timestamp('lastEvaluationAt'),
    lastEmailId: text('lastEmailId'),
    lastEmailSubject: text('lastEmailSubject'),
    cooldownUntil: timestamp('cooldownUntil'),
    disabled: boolean('disabled').notNull().default(false),
    disabledReason: text('disabledReason'),
    agentMemory: varchar('agentMemory', { length: 500 }),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('user_reminder_state_user_id_idx').on(table.userId),
    nextCheckAtIdx: index('user_reminder_state_next_check_at_idx').on(
      table.nextCheckAt,
    ),
    lastSentAtIdx: index('user_reminder_state_last_sent_at_idx').on(
      table.lastSentAt,
    ),
  }),
);

export type UserReminderState = InferSelectModel<typeof userReminderState>;

export const reminderEmailLog = pgTable(
  'reminder_email_log',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    decision: varchar('decision', { enum: ['sent', 'skipped'] }).notNull(),
    reason: varchar('reason', {
      enum: ['quiz_submitted', 'login', 'roadmap_updated', 'manual', 'scheduled'],
    }).notNull(),
    subject: text('subject'),
    tip: text('tip'),
    personalizedRecap: text('personalizedRecap'),
    nextCheckAt: timestamp('nextCheckAt'),
    modelMeta: json('modelMeta'),
    featuresUsed: json('featuresUsed'),
    why: text('why'),
  },
  (table) => ({
    userIdIdx: index('reminder_email_log_user_id_idx').on(table.userId),
    createdAtIdx: index('reminder_email_log_created_at_idx').on(table.createdAt),
    userCreatedAtIdx: index('reminder_email_log_user_created_at_idx').on(
      table.userId,
      table.createdAt,
    ),
  }),
);

export type ReminderEmailLog = InferSelectModel<typeof reminderEmailLog>;

export const agentWakeupLog = pgTable(
  'agent_wakeup_log',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id),
    agentId: uuid('agentId').references(() => agent.id),
    chatId: uuid('chatId').references(() => chat.id),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    decision: varchar('decision', { enum: ['sent', 'skipped'] }).notNull(),
    reason: text('reason'),
    why: text('why'),
    modelMeta: json('modelMeta'),
    featuresUsed: json('featuresUsed'),
  },
  (table) => ({
    userCreatedAtIdx: index('agent_wakeup_log_user_created_at_idx').on(
      table.userId,
      table.createdAt,
    ),
    decisionCreatedAtIdx: index('agent_wakeup_log_decision_created_at_idx').on(
      table.decision,
      table.createdAt,
    ),
  }),
);

export type AgentWakeupLog = InferSelectModel<typeof agentWakeupLog>;

export const subscription = pgTable(
  'subscription',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    tier: subscriptionTierEnum('tier').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    priceMonthly: numeric('priceMonthly', { precision: 10, scale: 2 })
      .notNull()
      .default('0.00'),
    dailyCredits: integer('dailyCredits').notNull().default(10),
    dailyQuizLimit: integer('dailyQuizLimit').notNull().default(5),
    dailyImageUploadLimit: integer('dailyImageUploadLimit')
      .notNull()
      .default(2),
    aiModel: text('aiModel').notNull().default('gemini-2.5-flash'),
    maxRoadmaps: integer('maxRoadmaps').notNull().default(3),
    streakShieldIncluded: boolean('streakShieldIncluded')
      .notNull()
      .default(false),
    prioritySupport: boolean('prioritySupport').notNull().default(false),
    exclusiveBadges: boolean('exclusiveBadges').notNull().default(false),
    benefits: json('benefits').$type<string[]>().default([]),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
  },
  (table) => ({
    tierIdx: uniqueIndex('subscription_tier_idx').on(table.tier),
  }),
);

export type Subscription = InferSelectModel<typeof subscription>;

export const userSubscription = pgTable(
  'user_subscription',
  {
    id: uuid('id').primaryKey().notNull().defaultRandom(),
    userId: uuid('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscriptionId')
      .notNull()
      .references(() => subscription.id),
    billingPeriod: billingPeriodEnum('billingPeriod')
      .notNull()
      .default('monthly'),
    startedAt: timestamp('startedAt').notNull().defaultNow(),
    expiresAt: timestamp('expiresAt'),
    isActive: boolean('isActive').notNull().default(true),
    createdAt: timestamp('createdAt').notNull().defaultNow(),
    updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: uniqueIndex('user_subscription_user_id_idx').on(table.userId),
    subscriptionIdIdx: index('user_subscription_subscription_id_idx').on(
      table.subscriptionId,
    ),
    activeUserIdx: index('user_subscription_user_active_idx').on(
      table.userId,
      table.isActive,
    ),
    activeExpiresIdx: index('user_subscription_active_expires_idx').on(
      table.isActive,
      table.expiresAt,
    ),
  }),
);

export type UserSubscription = InferSelectModel<typeof userSubscription>;
