import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import db from '../../drizzle';
import { eq, sql, desc } from 'drizzle-orm';
import { publicQuiz, user } from '../../lib/db/schema';
import { PublishQuizDto } from './dto/publish-quiz.dto';
import { SubmitPublicQuizDto } from './dto/submit-public-quiz.dto';
import { ActivityService } from '../activity/activity.service';

type SortOption = 'recent' | 'popular';

interface QuizQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

@Injectable()
export class QuizzesService {
  constructor(private readonly activityService: ActivityService) {}

  async publish(userId: string, dto: PublishQuizDto) {
    const questions = dto.questions as QuizQuestion[];
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (
        !q.options?.includes(q.correctAnswer) ||
        !q.question ||
        !q.explanation
      ) {
        throw new BadRequestException(
          `Question ${i + 1}: correctAnswer must be one of options, and question/explanation required`,
        );
      }
    }
    const [created] = await db
      .insert(publicQuiz)
      .values({
        title: dto.title,
        description: dto.description ?? null,
        questions: questions as unknown as Record<string, unknown>,
        createdBy: userId,
        sourceChatId: dto.sourceChatId ?? null,
      })
      .returning();
    return {
      id: created.id,
      title: created.title,
      description: created.description,
      createdBy: created.createdBy,
      createdAt: created.createdAt,
      viewCount: created.viewCount,
      attemptCount: created.attemptCount,
    };
  }

  async findAll(
    limit: number = 20,
    offset: number = 0,
    sort: SortOption = 'recent',
  ) {
    const orderBy =
      sort === 'popular'
        ? [desc(publicQuiz.attemptCount), desc(publicQuiz.viewCount)]
        : [desc(publicQuiz.createdAt)];
    const rows = await db
      .select({
        id: publicQuiz.id,
        title: publicQuiz.title,
        description: publicQuiz.description,
        createdBy: publicQuiz.createdBy,
        viewCount: publicQuiz.viewCount,
        attemptCount: publicQuiz.attemptCount,
        createdAt: publicQuiz.createdAt,
        creatorUsername: user.username,
      })
      .from(publicQuiz)
      .leftJoin(user, eq(publicQuiz.createdBy, user.id))
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      createdBy: r.createdBy,
      viewCount: r.viewCount,
      attemptCount: r.attemptCount,
      createdAt: r.createdAt,
      creatorUsername: r.creatorUsername ?? null,
    }));
  }

  async findOne(id: string) {
    const [quiz] = await db
      .select()
      .from(publicQuiz)
      .where(eq(publicQuiz.id, id))
      .limit(1);
    if (!quiz) {
      throw new NotFoundException(`Quiz ${id} not found`);
    }
    await db
      .update(publicQuiz)
      .set({
        viewCount: sql`${publicQuiz.viewCount} + 1`,
      })
      .where(eq(publicQuiz.id, id));
    return {
      ...quiz,
      viewCount: quiz.viewCount + 1,
    };
  }

  async submitAttempt(quizId: string, userId: string, dto: SubmitPublicQuizDto) {
    const [quiz] = await db
      .select()
      .from(publicQuiz)
      .where(eq(publicQuiz.id, quizId))
      .limit(1);
    if (!quiz) {
      throw new NotFoundException(`Quiz ${quizId} not found`);
    }
    const questions = quiz.questions as QuizQuestion[];
    const results: {
      questionIndex: number;
      selectedAnswer: string;
      correctAnswer: string;
      isCorrect: boolean;
    }[] = [];
    let correctCount = 0;
    for (const a of dto.answers) {
      if (a.questionIndex < 0 || a.questionIndex >= questions.length) {
        throw new BadRequestException(
          `Invalid questionIndex ${a.questionIndex}`,
        );
      }
      const q = questions[a.questionIndex];
      const isCorrect =
        String(a.selectedAnswer).trim() === String(q.correctAnswer).trim();
      if (isCorrect) correctCount++;
      results.push({
        questionIndex: a.questionIndex,
        selectedAnswer: a.selectedAnswer,
        correctAnswer: q.correctAnswer,
        isCorrect,
      });
    }
    await db
      .update(publicQuiz)
      .set({
        attemptCount: sql`${publicQuiz.attemptCount} + 1`,
      })
      .where(eq(publicQuiz.id, quizId));
    const submitDto = {
      userId,
      title: quiz.title,
      answers: results.map((r) => ({
        question: questions[r.questionIndex].question,
        selectedAnswer: r.selectedAnswer,
        correctAnswer: r.correctAnswer,
      })),
    };
    const activityResult = await this.activityService.submitQuiz(submitDto);
    return {
      score: correctCount,
      totalQuestions: questions.length,
      results,
      xpEarned: activityResult.xpEarned,
      activity: activityResult.activity,
    };
  }
}
