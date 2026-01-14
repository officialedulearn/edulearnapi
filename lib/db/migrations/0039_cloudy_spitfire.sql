CREATE TABLE "content_analytics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" text NOT NULL,
	"category" varchar(50) NOT NULL,
	"totalViews" integer DEFAULT 0,
	"lastUpdated" timestamp DEFAULT now() NOT NULL
);
