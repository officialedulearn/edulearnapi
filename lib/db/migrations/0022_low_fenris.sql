CREATE TABLE "earning" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"sol" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"edln" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "earning" ADD CONSTRAINT "earning_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;