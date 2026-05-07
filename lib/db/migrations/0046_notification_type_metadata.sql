ALTER TABLE "notifications"
ADD COLUMN "type" varchar(32) NOT NULL DEFAULT 'system_announcement';

ALTER TABLE "notifications"
ADD COLUMN "metadata" json;
