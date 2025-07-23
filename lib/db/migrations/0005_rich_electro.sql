ALTER TABLE "Chat" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "level" text DEFAULT 'beginner' NOT NULL;