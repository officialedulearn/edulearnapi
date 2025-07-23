CREATE TABLE "Claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"claimedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Claim_wallet_unique" UNIQUE("wallet")
);
--> statement-breakpoint
ALTER TABLE "Document" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "Suggestion" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "Vote" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "Document" CASCADE;--> statement-breakpoint
DROP TABLE "Suggestion" CASCADE;--> statement-breakpoint
DROP TABLE "Vote" CASCADE;--> statement-breakpoint
ALTER TABLE "User" ALTER COLUMN "credits" SET DEFAULT '20';--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN "tested" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "referredBy" text;--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "userPlan";--> statement-breakpoint
ALTER TABLE "User" DROP COLUMN "hasClaimedMemberNFT";