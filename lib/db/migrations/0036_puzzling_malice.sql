CREATE TABLE IF NOT EXISTS "community" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"inviteCode" varchar(256) NOT NULL,
	"visibility" varchar DEFAULT 'private' NOT NULL,
	"imageUrl" text,
	CONSTRAINT "community_inviteCode_unique" UNIQUE("inviteCode")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_join_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"communityId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now(),
	"status" varchar DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "community_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"communityId" uuid NOT NULL,
	"role" varchar DEFAULT 'member' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messageId" uuid NOT NULL,
	"mentionedUserId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_reaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"messageId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"reaction" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"title" text NOT NULL,
	"userId" uuid NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roomId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"content" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_join_request_userId_user_id_fk') THEN
  ALTER TABLE "community_join_request" ADD CONSTRAINT "community_join_request_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_join_request_communityId_community_id_fk') THEN
  ALTER TABLE "community_join_request" ADD CONSTRAINT "community_join_request_communityId_community_id_fk" FOREIGN KEY ("communityId") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_members_userId_user_id_fk') THEN
  ALTER TABLE "community_members" ADD CONSTRAINT "community_members_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'community_members_communityId_community_id_fk') THEN
  ALTER TABLE "community_members" ADD CONSTRAINT "community_members_communityId_community_id_fk" FOREIGN KEY ("communityId") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mention_messageId_room_message_id_fk') THEN
  ALTER TABLE "mention" ADD CONSTRAINT "mention_messageId_room_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."room_message"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mention_mentionedUserId_user_id_fk') THEN
  ALTER TABLE "mention" ADD CONSTRAINT "mention_mentionedUserId_user_id_fk" FOREIGN KEY ("mentionedUserId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reaction_messageId_room_message_id_fk') THEN
  ALTER TABLE "message_reaction" ADD CONSTRAINT "message_reaction_messageId_room_message_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."room_message"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reaction_userId_user_id_fk') THEN
  ALTER TABLE "message_reaction" ADD CONSTRAINT "message_reaction_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_userId_user_id_fk') THEN
  ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_message_roomId_community_id_fk') THEN
  ALTER TABLE "room_message" ADD CONSTRAINT "room_message_roomId_community_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_message_userId_user_id_fk') THEN
  ALTER TABLE "room_message" ADD CONSTRAINT "room_message_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;