CREATE TABLE "public_quiz" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"questions" json NOT NULL,
	"createdBy" uuid NOT NULL,
	"sourceChatId" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"viewCount" integer DEFAULT 0 NOT NULL,
	"attemptCount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_leaderboard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"week_start" timestamp NOT NULL,
	"week_end" timestamp NOT NULL,
	"xp_earned" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	"prize_awarded" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "username" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "streak_shield_active" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "streak_shield_expiry" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "streak_shield_purchases" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "public_quiz" ADD CONSTRAINT "public_quiz_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_quiz" ADD CONSTRAINT "public_quiz_sourceChatId_chat_id_fk" FOREIGN KEY ("sourceChatId") REFERENCES "public"."chat"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_leaderboard" ADD CONSTRAINT "weekly_leaderboard_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;