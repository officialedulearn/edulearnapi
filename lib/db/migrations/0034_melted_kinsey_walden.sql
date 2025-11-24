CREATE TABLE "total_volumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"totalRevenue" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"totalEdlnBurned" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
