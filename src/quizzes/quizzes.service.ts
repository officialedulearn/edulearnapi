import {
  Injectable,
  Inject,
  forwardRef,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import db from '../../drizzle';
import { and, eq, sql, desc, asc, max, min, count } from 'drizzle-orm';
import {
  publicQuiz,
  PublicQuizParticipation,
  publicQuizParticipation,
  user,
} from '../../lib/db/schema';
import { PublishQuizDto } from './dto/publish-quiz.dto';
import { SubmitPublicQuizDto } from './dto/submit-public-quiz.dto';
import { ActivityService } from '../activity/activity.service';
import { RemindersService } from 'src/reminders/reminders.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PublicQuiz } from '../../lib/db/schema';

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
    private readonly remindersService: RemindersService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache
  ) { }

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

  private async incrementQuizViewCount(id: string): Promise<void> {
    await db
      .update(publicQuiz)
      .set({
        viewCount: sql`${publicQuiz.viewCount} + 1`,
      })
      .where(eq(publicQuiz.id, id));
    return;
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
    const cacheKey = `public-quizzes:findAll:${sort}:${limit}:${offset}`;

    const cached = await this.cacheManager.get<any[]>(cacheKey);
    if (cached) {
      console.log('CACHE HIT:', cacheKey);
      return cached;
    }

    console.log('CACHE MISS:', cacheKey);

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

    const result = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      createdBy: r.createdBy,
      viewCount: r.viewCount,
      attemptCount: r.attemptCount,
      createdAt: r.createdAt,
      creatorUsername: r.creatorUsername ?? null,
    }));

    await this.cacheManager.set(cacheKey, result, 20_000); // 20s TTL

    return result;
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
    const cacheKey = `public-quiz:${id}`;

    const cached = await this.cacheManager.get<PublicQuiz | null>(cacheKey);
    if (cached) {
      await this.incrementQuizViewCount(id); // fire-and-forget or awaited
      return cached;
    }

    const quiz = await this.getQuizByIdOrThrow(id);

    await this.cacheManager.set(cacheKey, quiz, 60 * 60 * 24 * 7); // 7 days

    await this.incrementQuizViewCount(id);

    return quiz;
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

  async startQuiz(quizId: string, userId: string) {
    const quiz = await this.findOne(quizId); // cached quiz content

    const [countRow] = await db
      .select({ count: count() })
      .from(publicQuizParticipation)
      .where(
        and(
          eq(publicQuizParticipation.quizId, quizId),
          eq(publicQuizParticipation.userId, userId),
        ),
      );


    const participationCount = Number(countRow?.count ?? 0);

    if (participationCount >= 4) {
      throw new BadRequestException('You can join this quiz at most 4 times.');
    }


    const success = await db.transaction(async (tx) => {
      const [row] = await tx.insert(publicQuizParticipation)
        .values({ quizId, userId })
        .returning({
          id: publicQuizParticipation.id,
          quizId: publicQuizParticipation.quizId,
          joinedAt: publicQuizParticipation.joinedAt,
        });

      await tx.update(publicQuiz)
        .set({
          attemptCount: sql`${publicQuiz.attemptCount} + 1`,
        })
        .where(eq(publicQuiz.id, quizId));

      return {
        participationId: row.id,
        quizId: row.quizId,
        joinedAt: row.joinedAt,
      };
    });

    if (!success) {
      throw new BadRequestException('Failed to start quiz');
    }

    return {
      quiz,
      participation: {
        participationId: success.participationId,
        quizId: success.quizId,
        joinedAt: success.joinedAt,
      },
    };
  }

  async getQuizLeaderboard(quizId: string) {
    // Subquery: best score per user for this quiz
    const bestScores = db
      .select({
        userId: publicQuizParticipation.userId,
        maxScore: max(publicQuizParticipation.score).as("maxScore"),
        firstJoined: min(publicQuizParticipation.joinedAt).as("firstJoined"),
      })
      .from(publicQuizParticipation)
      .where(eq(publicQuizParticipation.quizId, quizId))
      .groupBy(publicQuizParticipation.userId)
      .as("bestScores");

    const leaderboard = await db
      .select({
        userId: bestScores.userId,
        score: bestScores.maxScore,
        joinedAt: bestScores.firstJoined,
        userId_: user.id,
        profilePictureURL: user.profilePictureURL,
        username: user.username,
        name: user.name,
      })
      .from(bestScores)
      .innerJoin(user, eq(user.id, bestScores.userId))
      .orderBy(desc(bestScores.maxScore), asc(bestScores.firstJoined))
      .limit(10);

    return leaderboard.map(({ ...row }) => ({
      userId: row.userId,
      score: row.score,
      joinedAt: row.joinedAt,
      user: {
        profilePictureURL: row.profilePictureURL,
        username: row.username,
        name: row.name,
      },
    }));
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

    await db
      .update(user)
      .set({
        quizCompleted: sql`${user.quizCompleted} + 1`,
      })
      .where(eq(user.id, userId));

    const payload = {
      score: correctCount,
      totalQuestions: questions.length,
      results,
      xpEarned: activityResult.xpEarned,
      activity: activityResult.activity,
    };

    this.remindersService
      .enqueueEvaluation(userId, 'quiz_submitted')
      .catch(() => undefined);

    return payload;
  }
}
