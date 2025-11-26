CREATE TABLE "total_volumes" (
	"id" integer PRIMARY KEY NOT NULL,
	"totalRevenue" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"totalEdlnBurned" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
