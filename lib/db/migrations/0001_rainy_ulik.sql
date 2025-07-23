ALTER TABLE "User" ADD COLUMN "lastLoggedIn" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "streak" integer DEFAULT 0 NOT NULL;