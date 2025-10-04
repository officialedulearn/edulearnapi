CREATE TABLE "roadmap_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roadmapId" uuid NOT NULL,
	"prompt" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"time" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"chatId" uuid NOT NULL,
	"topic" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roadmap_step" ADD CONSTRAINT "roadmap_step_roadmapId_roadmap_id_fk" FOREIGN KEY ("roadmapId") REFERENCES "public"."roadmap"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap" ADD CONSTRAINT "roadmap_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap" ADD CONSTRAINT "roadmap_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE no action ON UPDATE no action;