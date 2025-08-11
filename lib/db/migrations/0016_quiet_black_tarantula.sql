CREATE TABLE "premium_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"signature" varchar(256) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "premium_transactions_signature_unique" UNIQUE("signature")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "isPremium" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "premiumUntil" timestamp;--> statement-breakpoint
ALTER TABLE "premium_transactions" ADD CONSTRAINT "premium_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;