import { Injectable } from '@nestjs/common';
import db from '../../drizzle';
import { eq, and, sql, desc } from 'drizzle-orm';
import {
  xpActivity,
  user,
  type User,
  roadmap,
  userReward,
} from '../../lib/db/schema';
import { RewardsService } from '../rewards/rewards.service';
import { SubmitQuizDto } from './dto/submit-quiz.dto';
import { RoadmapService } from '../roadmap/roadmap.service';

@Injectable()
export class ActivityService {
  constructor(
    private rewardService: RewardsService,
    private roadmapService: RoadmapService,
  ) {}

  private buildActivityPaginationMeta(
    limit: number,
    page: number,
    dataCount: number,
    hasNextPage: boolean,
    total?: number,
  ) {
    const hasExactTotal = total !== undefined;
    const totalPages = hasExactTotal
      ? total > 0
        ? Math.ceil(total / limit)
        : 0
      : page + (hasNextPage ? 1 : 0);
    const visibleTotal =
      total ?? (page - 1) * limit + dataCount + (hasNextPage ? 1 : 0);
    const resolvedHasNextPage =
      hasExactTotal ? page < totalPages : hasNextPage;

    return {
      page,
      limit,
      count: dataCount,
      total: visibleTotal,
      totalPages,
      hasExactTotal,
      hasNextPage: resolvedHasNextPage,
      hasPrevPage: page > 1,
    };
  }

  async createActivity(data: {
    userId: string;
    title: string;
    type: 'quiz' | 'chat' | 'streak';
    xpEarned: number;
  }) {
    try {
      const [newActivity] = await db
        .insert(xpActivity)
        .values({
          userId: data.userId,
          title: data.title,
          type: data.type,
          xpEarned: data.xpEarned,
        })
        .returning();

      const userData = await db
        .select()
        .from(user)
        .where(eq(user.id, data.userId));

      if (!userData.length) {
        throw new Error(`User with id ${data.userId} not found`);
      }

      const currentUser = userData[0];
      const newXP = (currentUser.xp || 0) + data.xpEarned;

      let newLevel = 'novice';

      if (newXP >= 5000) {
        newLevel = 'expert';
      } else if (newXP >= 3000) {
        newLevel = 'advanced';
      } else if (newXP >= 1500) {
        newLevel = 'intermediate';
      } else if (newXP >= 500) {
        newLevel = 'beginner';
        console.log(
          `User ${data.userId} reached ${newXP} XP - awarding beginner NFT reward`,
        );
        try {
          await this.rewardService.awardRewardToUser(
            data.userId,
            '5e077518-2122-450d-b469-8388175a5a5f',
          );
          console.log(
            `Successfully awarded beginner NFT to user ${data.userId}`,
          );
        } catch (error) {
          if (
            error.message &&
            error.message.includes('already has this reward')
          ) {
            console.log(
              `User ${data.userId} already has the beginner NFT reward`,
            );
          } else {
            console.error(
              `Failed to award beginner NFT to user ${data.userId}:`,
              error,
            );
          }
        }
      }

      await db
        .update(user)
        .set({
          xp: newXP,
          level: newLevel as
            | 'novice'
            | 'beginner'
            | 'intermediate'
            | 'advanced'
            | 'expert',
        })
        .where(eq(user.id, data.userId));

      return newActivity;
    } catch (error) {
      console.error('Failed to create activity record', error);
      throw error;
    }
  }

  async submitQuiz(submitQuizDto: SubmitQuizDto) {
    try {
      let correctCount = 0;
      const validatedAnswers: {
        question: string;
        selectedAnswer: string;
        correctAnswer: string;
        isCorrect: boolean;
      }[] = [];

      for (const answer of submitQuizDto.answers) {
        const isCorrect =
          answer.selectedAnswer.trim() === answer.correctAnswer.trim();
        if (isCorrect) {
          correctCount++;
        }
        validatedAnswers.push({
          question: answer.question,
          selectedAnswer: answer.selectedAnswer,
          correctAnswer: answer.correctAnswer,
          isCorrect,
        });
      }

      const totalQuestions = submitQuizDto.answers.length;
      const xpEarned = correctCount;

      if (submitQuizDto.chatId) {
        console.log(`Quiz submitted for chatId: ${submitQuizDto.chatId}`);

        const roadmapData = await db
          .select()
          .from(roadmap)
          .where(eq(roadmap.chatId, submitQuizDto.chatId));

        if (roadmapData.length > 0 && roadmapData[0].claimableNFT) {
          const existingReward = await db
            .select()
            .from(userReward)
            .where(
              and(
                eq(userReward.userId, submitQuizDto.userId),
                eq(userReward.rewardId, roadmapData[0].claimableNFT),
              ),
            );

          if (existingReward.length === 0) {
            if (correctCount > 8) {
              console.log(
                `User ${submitQuizDto.userId} scored ${correctCount}/${totalQuestions}, checking if they should receive NFT for roadmap ${roadmapData[0].id}`,
              );
              await this.roadmapService.checkAndAwardRoadmapNFT(
                roadmapData[0].id,
                submitQuizDto.userId,
              );
            } else {
              console.log(
                `User ${submitQuizDto.userId} scored ${correctCount}/${totalQuestions}, score must be > 8 to earn NFT`,
              );
            }
          } else {
            console.log(
              `User ${submitQuizDto.userId} already has NFT ${roadmapData[0].claimableNFT}, skipping check`,
            );
          }
        }
      }

      const activity = await this.createActivity({
        userId: submitQuizDto.userId,
        title: submitQuizDto.title || 'Quiz',
        type: 'quiz',
        xpEarned,
      });

      return {
        activity,
        score: correctCount,
        totalQuestions,
        xpEarned,
        validatedAnswers,
        chatId: submitQuizDto.chatId,
      };
    } catch (error) {
      console.error('Failed to submit quiz', error);
      throw error;
    }
  }

  async getActivitiesByUser(
    userId: string,
    pagination?: { limit: number; page: number; includeTotal?: boolean },
  ) {
    try {
      const safeLimit = Math.max(1, Math.min(100, pagination?.limit ?? 10));
      const safePage = Math.max(1, pagination?.page ?? 1);
      const offset = (safePage - 1) * safeLimit;
      const includeTotal = pagination?.includeTotal === true;

      const activitiesQuery = db
        .select({
          id: xpActivity.id,
          title: xpActivity.title,
          xpEarned: xpActivity.xpEarned,
          createdAt: xpActivity.createdAt,
        })
        .from(xpActivity)
        .where(eq(xpActivity.userId, userId))
        .orderBy(desc(xpActivity.createdAt))
        .limit(includeTotal ? safeLimit : safeLimit + 1)
        .offset(offset);

      if (includeTotal) {
        const [activities, [countResult]] = await Promise.all([
          activitiesQuery,
          db
            .select({ count: sql<number>`count(*)` })
            .from(xpActivity)
            .where(eq(xpActivity.userId, userId)),
        ]);

        const total = Number(countResult?.count ?? 0);

        return {
          data: activities,
          pagination: this.buildActivityPaginationMeta(
            safeLimit,
            safePage,
            activities.length,
            safePage * safeLimit < total,
            total,
          ),
        };
      }

      const activityRows = await activitiesQuery;
      const hasNextPage = activityRows.length > safeLimit;
      const activities = hasNextPage
        ? activityRows.slice(0, safeLimit)
        : activityRows;

      return {
        data: activities,
        pagination: this.buildActivityPaginationMeta(
          safeLimit,
          safePage,
          activities.length,
          hasNextPage,
        ),
      };
    } catch (error) {
      console.error(
        `Failed to get activities for user with id ${userId}`,
        error,
      );
      throw error;
    }
  }

  async getQuizActivitiesByUser(userId: string) {
    try {
      return await db
        .select()
        .from(xpActivity)
        .where(and(eq(xpActivity.userId, userId), eq(xpActivity.type, 'quiz')))
        .orderBy(xpActivity.createdAt);
    } catch (error) {
      console.error(
        `Failed to get quiz activities for user with id ${userId}`,
        error,
      );
      throw error;
    }
  }

  async getTotalXpByActivityType(
    userId: string,
    type: 'quiz' | 'chat' | 'streak',
  ) {
    try {
      const result = await db
        .select({ total: sql`sum(${xpActivity.xpEarned})` })
        .from(xpActivity)
        .where(and(eq(xpActivity.userId, userId), eq(xpActivity.type, type)));

      return result[0]?.total || 0;
    } catch (error) {
      console.error(
        `Failed to get total XP for user with id ${userId} and type ${type}`,
        error,
      );
      throw error;
    }
  }

  async getAllActivities() {
    try {
      return await db.select().from(xpActivity).orderBy(xpActivity.createdAt);
    } catch (error) {
      console.error('Failed to get all activities', error);
      throw error;
    }
  }

  async getUserWithActivities(
    userId: string,
  ): Promise<{ user: User; activities: any[] }> {
    try {
      const userData = await db.select().from(user).where(eq(user.id, userId));
      if (!userData.length) {
        throw new Error(`User with id ${userId} not found`);
      }

      const { data: activities } = await this.getActivitiesByUser(userId);

      return {
        user: userData[0],
        activities,
      };
    } catch (error) {
      console.error(
        `Failed to get user with activities for user id ${userId}`,
        error,
      );
      throw error;
    }
  }
}
