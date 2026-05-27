CREATE TABLE IF NOT EXISTS "roadmap_sub_step" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "stepId" uuid NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "context" text DEFAULT '' NOT NULL,
  "sortOrder" integer NOT NULL,
  "done" boolean DEFAULT false NOT NULL,
  "completedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "roadmap_sub_step_stepId_roadmap_step_id_fk"
    FOREIGN KEY ("stepId") REFERENCES "roadmap_step"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "roadmap_sub_step_step_order_idx"
  ON "roadmap_sub_step" ("stepId", "sortOrder");

CREATE INDEX IF NOT EXISTS "roadmap_sub_step_step_done_idx"
  ON "roadmap_sub_step" ("stepId", "done");

CREATE TABLE IF NOT EXISTS "roadmap_verification_quiz" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL,
  "roadmapId" uuid NOT NULL,
  "stepId" uuid NOT NULL,
  "subStepId" uuid NOT NULL,
  "questions" json NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "roadmap_verification_quiz_userId_user_id_fk"
    FOREIGN KEY ("userId") REFERENCES "user"("id"),
  CONSTRAINT "roadmap_verification_quiz_roadmapId_roadmap_id_fk"
    FOREIGN KEY ("roadmapId") REFERENCES "roadmap"("id") ON DELETE cascade,
  CONSTRAINT "roadmap_verification_quiz_stepId_roadmap_step_id_fk"
    FOREIGN KEY ("stepId") REFERENCES "roadmap_step"("id") ON DELETE cascade,
  CONSTRAINT "roadmap_verification_quiz_subStepId_roadmap_sub_step_id_fk"
    FOREIGN KEY ("subStepId") REFERENCES "roadmap_sub_step"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "roadmap_verification_quiz_sub_step_created_idx"
  ON "roadmap_verification_quiz" ("subStepId", "createdAt");

CREATE INDEX IF NOT EXISTS "roadmap_verification_quiz_user_created_idx"
  ON "roadmap_verification_quiz" ("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "roadmap_verification_quiz_attempt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "quizId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "subStepId" uuid NOT NULL,
  "answers" json NOT NULL,
  "results" json NOT NULL,
  "score" integer NOT NULL,
  "totalQuestions" integer NOT NULL,
  "passed" boolean NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "roadmap_verification_quiz_attempt_quizId_quiz_id_fk"
    FOREIGN KEY ("quizId") REFERENCES "roadmap_verification_quiz"("id") ON DELETE cascade,
  CONSTRAINT "roadmap_verification_quiz_attempt_userId_user_id_fk"
    FOREIGN KEY ("userId") REFERENCES "user"("id"),
  CONSTRAINT "roadmap_verification_quiz_attempt_subStepId_sub_step_id_fk"
    FOREIGN KEY ("subStepId") REFERENCES "roadmap_sub_step"("id") ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS "roadmap_verification_attempt_quiz_idx"
  ON "roadmap_verification_quiz_attempt" ("quizId");

CREATE INDEX IF NOT EXISTS "roadmap_verification_attempt_sub_step_created_idx"
  ON "roadmap_verification_quiz_attempt" ("subStepId", "createdAt");
