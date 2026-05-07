CREATE TABLE "agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"profile_picture_url" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"decision" varchar NOT NULL,
	"reason" varchar NOT NULL,
	"subject" text,
	"tip" text,
	"personalizedRecap" text,
	"nextCheckAt" timestamp,
	"modelMeta" json,
	"featuresUsed" json,
	"why" text
);
--> statement-breakpoint
CREATE TABLE "user_reminder_state" (
	"userId" uuid NOT NULL,
	"nextCheckAt" timestamp,
	"lastSentAt" timestamp,
	"lastEvaluationAt" timestamp,
	"lastEmailId" text,
	"lastEmailSubject" text,
	"cooldownUntil" timestamp,
	"disabled" boolean DEFAULT false NOT NULL,
	"disabledReason" text,
	"agentMemory" varchar(500),
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_reminder_state_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
ALTER TABLE "quiz_generation_schedule" DROP CONSTRAINT "quiz_generation_schedule_userId_unique";--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "type" varchar DEFAULT 'system_announcement' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "metadata" json;--> statement-breakpoint
ALTER TABLE "public_quiz" ADD COLUMN "creatorId" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "memory" varchar(500) DEFAULT '';--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_email_log" ADD CONSTRAINT "reminder_email_log_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reminder_state" ADD CONSTRAINT "user_reminder_state_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminder_email_log_user_id_idx" ON "reminder_email_log" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "reminder_email_log_created_at_idx" ON "reminder_email_log" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "reminder_email_log_user_created_at_idx" ON "reminder_email_log" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "user_reminder_state_user_id_idx" ON "user_reminder_state" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "user_reminder_state_next_check_at_idx" ON "user_reminder_state" USING btree ("nextCheckAt");--> statement-breakpoint
CREATE INDEX "user_reminder_state_last_sent_at_idx" ON "user_reminder_state" USING btree ("lastSentAt");--> statement-breakpoint
ALTER TABLE "public_quiz" ADD CONSTRAINT "public_quiz_creatorId_user_id_fk" FOREIGN KEY ("creatorId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;