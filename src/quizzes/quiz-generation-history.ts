import { desc, eq } from 'drizzle-orm';
import db from '../../drizzle';
import { publicQuiz } from '../../lib/db/schema';
import type {
  QuizGenerationHistoryItem,
  QuizQuestionLike,
} from 'src/ai/quiz-diversity.util';

function toQuestions(value: unknown): QuizQuestionLike[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is QuizQuestionLike => {
      const q = item as Partial<QuizQuestionLike>;
      return (
        typeof q.question === 'string' &&
        Array.isArray(q.options) &&
        typeof q.correctAnswer === 'string' &&
        typeof q.explanation === 'string'
      );
    })
    .slice(0, 100);
}

function toConcepts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export async function getRecentQuizGenerationHistory(
  userId: string,
  limit = 10,
): Promise<QuizGenerationHistoryItem[]> {
  const rows = await db
    .select({
      title: publicQuiz.title,
      summary: publicQuiz.summary,
      coveredConcepts: publicQuiz.coveredConcepts,
      challengeProfile: publicQuiz.challengeProfile,
      questions: publicQuiz.questions,
    })
    .from(publicQuiz)
    .where(eq(publicQuiz.createdBy, userId))
    .orderBy(desc(publicQuiz.createdAt))
    .limit(limit);

  let remainingQuestions = 100;
  const history: QuizGenerationHistoryItem[] = [];
  for (const row of rows) {
    if (remainingQuestions <= 0) break;
    const questions = toQuestions(row.questions).slice(0, remainingQuestions);
    remainingQuestions -= questions.length;
    history.push({
      title: row.title,
      summary: row.summary ?? null,
      coveredConcepts: toConcepts(row.coveredConcepts),
      challengeProfile: row.challengeProfile ?? null,
      questions,
    });
  }
  return history;
}
