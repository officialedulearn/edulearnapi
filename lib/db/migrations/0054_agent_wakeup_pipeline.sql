CREATE TABLE "public_quiz_attempt_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"quizId" uuid NOT NULL,
	"participationId" uuid NOT NULL,
	"questionIndex" integer NOT NULL,
	"question" text NOT NULL,
	"selectedAnswer" text NOT NULL,
	"correctAnswer" text NOT NULL,
	"explanation" text NOT NULL,
	"isCorrect" boolean NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public_quiz_attempt_answer" ADD CONSTRAINT "public_quiz_attempt_answer_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public_quiz_attempt_answer" ADD CONSTRAINT "public_quiz_attempt_answer_quizId_public_quiz_id_fk" FOREIGN KEY ("quizId") REFERENCES "public"."public_quiz"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "public_quiz_attempt_answer" ADD CONSTRAINT "public_quiz_attempt_answer_participationId_public_quiz_participation_id_fk" FOREIGN KEY ("participationId") REFERENCES "public"."public_quiz_participation"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "public_quiz_attempt_answer_participation_id_idx" ON "public_quiz_attempt_answer" USING btree ("participationId");
--> statement-breakpoint
CREATE INDEX "public_quiz_attempt_answer_user_created_at_idx" ON "public_quiz_attempt_answer" USING btree ("userId","createdAt");
--> statement-breakpoint
CREATE TABLE "agent_wakeup_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"agentId" uuid,
	"chatId" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"decision" varchar NOT NULL,
	"reason" text,
	"why" text,
	"modelMeta" json,
	"featuresUsed" json
);
--> statement-breakpoint
ALTER TABLE "agent_wakeup_log" ADD CONSTRAINT "agent_wakeup_log_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_wakeup_log" ADD CONSTRAINT "agent_wakeup_log_agentId_agent_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."agent"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_wakeup_log" ADD CONSTRAINT "agent_wakeup_log_chatId_chat_id_fk" FOREIGN KEY ("chatId") REFERENCES "public"."chat"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_wakeup_log_user_created_at_idx" ON "agent_wakeup_log" USING btree ("userId","createdAt");
--> statement-breakpoint
CREATE INDEX "agent_wakeup_log_decision_created_at_idx" ON "agent_wakeup_log" USING btree ("decision","createdAt");
