ALTER TABLE "reward" ADD COLUMN "ipfs" text NOT NULL;--> statement-breakpoint
ALTER TABLE "reward" ADD CONSTRAINT "reward_ipfs_unique" UNIQUE("ipfs");