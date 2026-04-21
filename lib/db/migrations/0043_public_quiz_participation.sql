CREATE TABLE "public_quiz_participation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"quizId" uuid NOT NULL,
	"joinedAt" timestamp DEFAULT now() NOT NULL,
	"submittedAt" timestamp,
	"score" integer,
	"totalQuestions" integer
);
--> statement-breakpoint
ALTER TABLE "public_quiz_participation" ADD CONSTRAINT "public_quiz_participation_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_quiz_participation" ADD CONSTRAINT "public_quiz_participation_quizId_public_quiz_id_fk" FOREIGN KEY ("quizId") REFERENCES "public"."public_quiz"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "public_quiz_participation_user_quiz_idx" ON "public_quiz_participation" USING btree ("userId","quizId");
