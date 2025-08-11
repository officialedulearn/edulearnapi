ALTER TABLE "user_reward" ADD COLUMN "signature" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user_reward" ADD CONSTRAINT "user_reward_signature_unique" UNIQUE("signature");