CREATE INDEX IF NOT EXISTS "message_reaction_message_id_idx" ON "message_reaction" ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_reaction_message_id_user_id_idx" ON "message_reaction" ("messageId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_message_room_id_created_at_idx" ON "room_message" ("roomId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "community_members_community_id_user_id_idx" ON "community_members" ("communityId","userId");
