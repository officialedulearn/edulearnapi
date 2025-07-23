ALTER TABLE "User" ADD COLUMN "referralCode" text;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "referralCount" integer DEFAULT 0;