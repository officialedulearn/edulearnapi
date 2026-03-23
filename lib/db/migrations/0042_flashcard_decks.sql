CREATE TABLE "flashcard" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deckId" uuid NOT NULL,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"sortOrder" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flashcard_deck" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"title" text NOT NULL,
	"topic" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "flashcard" ADD CONSTRAINT "flashcard_deckId_flashcard_deck_id_fk" FOREIGN KEY ("deckId") REFERENCES "public"."flashcard_deck"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_deck" ADD CONSTRAINT "flashcard_deck_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flashcard_deck_user_id_idx" ON "flashcard_deck" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "flashcard_deck_user_id_created_at_idx" ON "flashcard_deck" USING btree ("userId","createdAt");