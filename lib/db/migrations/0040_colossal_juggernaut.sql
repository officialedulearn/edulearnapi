ALTER TABLE "user" ADD COLUMN "oauth_provider" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "oauth_provider_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "has_completed_profile" boolean DEFAULT true;