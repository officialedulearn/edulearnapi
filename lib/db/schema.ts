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
  credits: numeric('credits', { precision: 10, scale: 2 }).notNull().default('20'),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  lastLoggedIn: timestamp('lastLoggedIn').notNull().defaultNow(),
  streak: integer('streak').notNull().default(1),
  referralCode: text('referralCode'),
  referralCount: integer('referralCount').default(0),
  referredBy: text('referredBy'),
  level: varchar('level', { enum: ['novice', 'beginner', 'intermediate', 'advanced', 'expert'] })
    .notNull()
    .default('novice'),
username: text('username').notNull().unique(),
});

export type User = InferSelectModel<typeof user>;

export const claim = pgTable('claim', {
  id: uuid('id').primaryKey().notNull().defaultRandom(),
  wallet: text('wallet').notNull().unique(),
  claimedAt: timestamp('claimedAt').notNull().defaultNow(),
});

export type Claim = InferSelectModel<typeof claim>;

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
  tested: boolean('tested').default(false)
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