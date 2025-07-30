CREATE TABLE "reward" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"imageUrl" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_reward" (
	"userId" uuid NOT NULL,
	"rewardId" uuid NOT NULL,
	"earnedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_reward_userId_rewardId_pk" PRIMARY KEY("userId","rewardId")
);
--> statement-breakpoint
ALTER TABLE "user_reward" ADD CONSTRAINT "user_reward_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reward" ADD CONSTRAINT "user_reward_rewardId_reward_id_fk" FOREIGN KEY ("rewardId") REFERENCES "public"."reward"("id") ON DELETE no action ON UPDATE no action;