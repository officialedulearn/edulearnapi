CREATE TABLE "quiz_generation_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"topic" text NOT NULL,
	"difficulty" varchar NOT NULL,
	"cronExpression" text NOT NULL,
	"timeZone" text DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_generation_schedule_userId_unique" UNIQUE("userId")
);
--> statement-breakpoint
ALTER TABLE "quiz_generation_schedule" ADD CONSTRAINT "quiz_generation_schedule_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
