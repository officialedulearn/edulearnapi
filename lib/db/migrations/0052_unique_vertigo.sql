CREATE INDEX "community_members_community_id_user_id_idx" ON "community_members" USING btree ("communityId","userId");--> statement-breakpoint
CREATE INDEX "message_reaction_message_id_idx" ON "message_reaction" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX "message_reaction_message_id_user_id_idx" ON "message_reaction" USING btree ("messageId","userId");--> statement-breakpoint
CREATE INDEX "room_message_room_id_created_at_idx" ON "room_message" USING btree ("roomId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_idx" ON "user" USING btree ("username");