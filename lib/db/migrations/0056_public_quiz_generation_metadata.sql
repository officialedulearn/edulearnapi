ALTER TABLE "public_quiz" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "public_quiz" ADD COLUMN IF NOT EXISTS "coveredConcepts" json;
ALTER TABLE "public_quiz" ADD COLUMN IF NOT EXISTS "challengeProfile" text;
