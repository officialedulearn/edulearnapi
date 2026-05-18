ALTER TABLE "user"
ADD COLUMN "settingsPreferences" json DEFAULT '{"pushNotifications":true,"inAppNotifications":true,"emailNotifications":true,"agentWake":true,"memoryEnabled":true}'::json;
--> statement-breakpoint
UPDATE "user"
SET "settingsPreferences" = '{"pushNotifications":true,"inAppNotifications":true,"emailNotifications":true,"agentWake":true,"memoryEnabled":true}'::json
WHERE "settingsPreferences" IS NULL;
