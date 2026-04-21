import {
  Injectable,
  Inject,
  forwardRef,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import db from '../../drizzle';
import { and, eq, sql, desc } from 'drizzle-orm';
import {
  publicQuiz,
  publicQuizParticipation,
  user,
} from '../../lib/db/schema';
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
  constructor(
    @Inject(forwardRef(() => ActivityService))
    private readonly activityService: ActivityService,
  ) {}

  private async getQuizByIdOrThrow(id: string) {
    const [quiz] = await db
      .select()
      .from(publicQuiz)
      .where(eq(publicQuiz.id, id))
      .limit(1);
    if (!quiz) {
      throw new NotFoundException(`Quiz ${id} not found`);
    }
    return quiz;
  }

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

  async findMine(userId: string, limit: number = 20, offset: number = 0) {
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
      .where(eq(publicQuiz.createdBy, userId))
      .orderBy(desc(publicQuiz.createdAt))
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
    const quiz = await this.getQuizByIdOrThrow(id);
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

  async startParticipation(quizId: string, userId: string) {
    await this.getQuizByIdOrThrow(quizId);

    const [countRow] = await db
      .select({ count: sql`count(*)` })
      .from(publicQuizParticipation)
      .where(
        and(
          eq(publicQuizParticipation.quizId, quizId),
          eq(publicQuizParticipation.userId, userId),
        ),
      );
    const participationCount = Number(countRow?.count ?? 0);
    if (participationCount >= 4) {
      throw new BadRequestException(
        'You can join this quiz at most 4 times.',
      );
    }

    const [row] = await db
      .insert(publicQuizParticipation)
      .values({ quizId, userId })
      .returning();
    return {
      participationId: row.id,
      quizId: row.quizId,
      joinedAt: row.joinedAt,
    };
  }

  async submitAttempt(
    quizId: string,
    userId: string,
    dto: SubmitPublicQuizDto,
  ) {
    const quiz = await this.getQuizByIdOrThrow(quizId);

    if (dto.participationId) {
      const [participation] = await db
        .select()
        .from(publicQuizParticipation)
        .where(
          and(
            eq(publicQuizParticipation.id, dto.participationId),
            eq(publicQuizParticipation.userId, userId),
            eq(publicQuizParticipation.quizId, quizId),
          ),
        )
        .limit(1);
      if (!participation) {
        throw new BadRequestException(
          'Invalid participationId for this quiz and user',
        );
      }
      if (participation.submittedAt) {
        throw new BadRequestException('This attempt was already submitted');
      }
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

    if (dto.participationId) {
      await db
        .update(publicQuizParticipation)
        .set({
          submittedAt: new Date(),
          score: correctCount,
          totalQuestions: questions.length,
        })
        .where(eq(publicQuizParticipation.id, dto.participationId));
    }

    return {
      score: correctCount,
      totalQuestions: questions.length,
      results,
      xpEarned: activityResult.xpEarned,
      activity: activityResult.activity,
    };
  }
}
