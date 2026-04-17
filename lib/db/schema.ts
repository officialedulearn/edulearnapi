import type { InferSelectModel } from 'drizzle-orm';
import {
  pgTable,
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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
  expoPushToken: text('expoPushToken'),
  profilePictureURL: text('profilePictureURL'),
  oauthProvider: text('oauth_provider'),
  oauthProviderId: text('oauth_provider_id'),
  hasCompletedProfile: boolean('has_completed_profile').default(true),
  streakShieldActive: boolean('streak_shield_active').default(false),
  streakShieldExpiry: timestamp('streak_shield_expiry'),
  streakShieldPurchases: integer('streak_shield_purchases').default(0),
});

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

export const message = pgTable('message', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  chatId: uuid('chatId')
    .notNull()
    .references(() => chat.id),
  role: varchar('role').notNull(),
  content: json('content').notNull(),
  createdAt: timestamp('createdAt').notNull(),
});

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
});

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

export const roomMessage = pgTable('room_message', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  roomId: uuid('roomId')
    .notNull()
    .references(() => community.id),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  content: text('content').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export type roomMessage = InferSelectModel<typeof roomMessage>;

export const messageReaction = pgTable('message_reaction', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  messageId: uuid('messageId')
    .notNull()
    .references(() => roomMessage.id),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  reaction: text('reaction').notNull(),
});

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

export const community_members = pgTable('community_members', {
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
});

export type CommunityMembers = InferSelectModel<typeof community_members>;

export const notifications = pgTable('notifications', {
  id: uuid('id').notNull().primaryKey().defaultRandom(),
  content: text('content').notNull(),
  title: text('title').notNull(),
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
});

export type PublicQuiz = InferSelectModel<typeof publicQuiz>;

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
