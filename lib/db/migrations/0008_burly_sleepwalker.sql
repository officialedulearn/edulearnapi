CREATE TABLE "chat" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdAt" timestamp NOT NULL,
	"title" text NOT NULL,
	"userId" uuid NOT NULL,
	"visibility" varchar DEFAULT 'private' NOT NULL,
	"tested" boolean DEFAULT false,
	CONSTRAINT "chat_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"claimedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "claim_wallet_unique" UNIQUE("wallet")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chatId" uuid NOT NULL,
	"role" varchar NOT NULL,
	"content" json NOT NULL,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"address" text,
	"xp" integer DEFAULT 0 NOT NULL,
	"credits" numeric(10, 2) DEFAULT '20' NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"lastLoggedIn" timestamp DEFAULT now() NOT NULL,
	"streak" integer DEFAULT 1 NOT NULL,
	"referralCode" text,
	"referralCount" integer DEFAULT 0,
	"referredBy" text,
	"level" varchar DEFAULT 'novice' NOT NULL,
	CONSTRAINT "user_id_unique" UNIQUE("id"),
	CONSTRAINT "user_address_unique" UNIQUE("address"),
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DROP TABLE "Chat" CASCADE;--> statement-breakpoint
DROP TABLE "Claim" CASCADE;--> statement-breakpoint
DROP TABLE "Message" CASCADE;--> statement-breakpoint
DROP TABLE "User" CASCADE;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE no action ON UPDATE no action;