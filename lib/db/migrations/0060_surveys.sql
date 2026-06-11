CREATE TABLE "surveys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" varchar DEFAULT 'draft' NOT NULL,
  "isActive" boolean DEFAULT false NOT NULL,
  "publishedAt" timestamp,
  "archivedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "survey_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "surveyId" uuid NOT NULL,
  "prompt" text NOT NULL,
  "type" varchar NOT NULL,
  "options" json DEFAULT '[]'::json NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "sortOrder" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "survey_responses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "surveyId" uuid NOT NULL,
  "userId" uuid,
  "submittedAt" timestamp DEFAULT now() NOT NULL,
  "metadata" json
);

CREATE TABLE "survey_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "responseId" uuid NOT NULL,
  "surveyId" uuid NOT NULL,
  "questionId" uuid NOT NULL,
  "questionPrompt" text NOT NULL,
  "questionType" varchar NOT NULL,
  "value" json,
  "textValue" text,
  "numberValue" integer,
  "booleanValue" boolean,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "survey_ai_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "surveyId" uuid NOT NULL,
  "model" text DEFAULT 'gemini-2.5-flash' NOT NULL,
  "promptVersion" text DEFAULT 'survey-analysis-v1' NOT NULL,
  "responseCountAnalyzed" integer DEFAULT 0 NOT NULL,
  "latestResponseAtAnalyzed" timestamp,
  "analysis" json NOT NULL,
  "generatedAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "survey_questions"
  ADD CONSTRAINT "survey_questions_surveyId_surveys_id_fk"
  FOREIGN KEY ("surveyId") REFERENCES "public"."surveys"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "survey_responses"
  ADD CONSTRAINT "survey_responses_surveyId_surveys_id_fk"
  FOREIGN KEY ("surveyId") REFERENCES "public"."surveys"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "survey_responses"
  ADD CONSTRAINT "survey_responses_userId_user_id_fk"
  FOREIGN KEY ("userId") REFERENCES "public"."user"("id")
  ON DELETE no action ON UPDATE no action;

ALTER TABLE "survey_answers"
  ADD CONSTRAINT "survey_answers_responseId_survey_responses_id_fk"
  FOREIGN KEY ("responseId") REFERENCES "public"."survey_responses"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "survey_answers"
  ADD CONSTRAINT "survey_answers_surveyId_surveys_id_fk"
  FOREIGN KEY ("surveyId") REFERENCES "public"."surveys"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "survey_answers"
  ADD CONSTRAINT "survey_answers_questionId_survey_questions_id_fk"
  FOREIGN KEY ("questionId") REFERENCES "public"."survey_questions"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "survey_ai_analyses"
  ADD CONSTRAINT "survey_ai_analyses_surveyId_surveys_id_fk"
  FOREIGN KEY ("surveyId") REFERENCES "public"."surveys"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE UNIQUE INDEX "surveys_slug_idx" ON "surveys" USING btree ("slug");
CREATE INDEX "surveys_active_idx" ON "surveys" USING btree ("isActive", "status");
CREATE INDEX "survey_questions_survey_order_idx" ON "survey_questions" USING btree ("surveyId", "sortOrder");
CREATE INDEX "survey_responses_survey_submitted_idx" ON "survey_responses" USING btree ("surveyId", "submittedAt");
CREATE INDEX "survey_responses_user_submitted_idx" ON "survey_responses" USING btree ("userId", "submittedAt");
CREATE UNIQUE INDEX "survey_answers_response_question_idx" ON "survey_answers" USING btree ("responseId", "questionId");
CREATE INDEX "survey_answers_survey_question_idx" ON "survey_answers" USING btree ("surveyId", "questionId");
CREATE UNIQUE INDEX "survey_ai_analyses_survey_idx" ON "survey_ai_analyses" USING btree ("surveyId");
