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
} from 'drizzle-orm/pg-core';

export const user = pgTable('user', {
  id: uuid('id').primaryKey().unique().notNull(),
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
  referredBy: text('referredBy'),
  level: varchar('level', {
    enum: ['novice', 'beginner', 'intermediate', 'advanced', 'expert'],
  })
    .notNull()
    .default('novice'),
  username: text('username').notNull().unique(),
  quizCompleted: integer('quizCompleted').notNull().default(0),
  encryptedPrivateKey: text('encryptedPrivateKey').notNull(),
  lastCreditRenewal: timestamp('last_credit_renewal'),
  isPremium: boolean('isPremium').default(false),
  premiumUntil: timestamp('premiumUntil'),
  verified: boolean('verified').default(false),
  imageUploadLimit: integer('imageUploadLimit').default(3),
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
    // Add a composite primary key to ensure a user can only earn a specific reward once
    // If you want users to earn the same reward multiple times, you'd need to add another unique identifier
    // in this table and remove this composite primary key
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.userId, table.rewardId] }),
    };
  },
);

export type UserReward = InferSelectModel<typeof userReward>;

export const chat = pgTable('chat', {
  id: uuid('id').primaryKey().unique().notNull().defaultRandom(),
  createdAt: timestamp('createdAt').notNull(),
  title: text('title').notNull(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  visibility: varchar('visibility', { enum: ['public', 'private'] })
    .notNull()
    .default('private'),
  tested: boolean('tested').default(false),
});

export type Chat = InferSelectModel<typeof chat>;

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
  userId: uuid('user_id').notNull().references(() => user.id),
  signature: varchar('signature', { length: 256 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

export type PremiumTransaction = InferSelectModel<typeof premiumTransactions>;

export const earning = pgTable('earning', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  userId: uuid('userId')
    .notNull()
    .references(() => user.id),
  sol: numeric('sol', { precision: 10, scale: 2 })
    .notNull()
    .default('0.00'),
  edln: numeric('edln', { precision: 10, scale: 2 })
    .notNull()
    .default('0.00'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
});

export type Earning = InferSelectModel<typeof earning>;