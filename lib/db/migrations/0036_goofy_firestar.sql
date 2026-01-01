ALTER TABLE "user_follows" ADD COLUMN "emailNotifications" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_follows" ADD COLUMN "pushNotifications" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_follows" ADD COLUMN "inAppNotifications" boolean DEFAULT true;