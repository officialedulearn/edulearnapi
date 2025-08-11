import { Injectable } from '@nestjs/common';
import db from '../../drizzle';
import { eq, and, sql } from 'drizzle-orm';
import { xpActivity, user, type User } from '../../lib/db/schema';
import { RewardsService } from '../rewards/rewards.service';

@Injectable()
export class ActivityService {
  constructor(private rewardService: RewardsService) {}
  
  async createActivity(data: { 
    userId: string; 
    title: string;
    type: 'quiz' | 'chat' | 'streak';
    xpEarned: number;
  }) {
    try {
      const [newActivity] = await db.insert(xpActivity).values({
        userId: data.userId,
        title: data.title,
        type: data.type,
        xpEarned: data.xpEarned,
      }).returning();
      
      const userData = await db.select()
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
        console.log(`User ${data.userId} reached ${newXP} XP - awarding beginner NFT reward`);
        try {
          await this.rewardService.awardRewardToUser(
            data.userId,
            'e7928044-628c-4a82-982d-f08fd997fea0',
          );
          console.log(`Successfully awarded beginner NFT to user ${data.userId}`);
        } catch (error) {
          if (error.message && error.message.includes('already has this reward')) {
            console.log(`User ${data.userId} already has the beginner NFT reward`);
          } else {
            console.error(`Failed to award beginner NFT to user ${data.userId}:`, error);
          }
        }
      }
      
      await db.update(user)
        .set({ 
          xp: newXP,
          level: newLevel as 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'expert'
        })
        .where(eq(user.id, data.userId));
      
      return newActivity;
    } catch (error) {
      console.error('Failed to create activity record', error);
      throw error;
    }
  }

  async getActivitiesByUser(userId: string) {
    try {
      return await db.select()
        .from(xpActivity)
        .where(eq(xpActivity.userId, userId))
        .orderBy(xpActivity.createdAt);
    } catch (error) {
      console.error(`Failed to get activities for user with id ${userId}`, error);
      throw error;
    }
  }

  async getQuizActivitiesByUser(userId: string) {
    try {
      return await db.select()
        .from(xpActivity)
        .where(and(
          eq(xpActivity.userId, userId),
          eq(xpActivity.type, 'quiz')
        ))
        .orderBy(xpActivity.createdAt);
    } catch (error) {
      console.error(`Failed to get quiz activities for user with id ${userId}`, error);
      throw error;
    }
  }

  async getTotalXpByActivityType(userId: string, type: 'quiz' | 'chat' | 'streak') {
    try {
      const result = await db
        .select({ total: sql`sum(${xpActivity.xpEarned})` })
        .from(xpActivity)
        .where(and(
          eq(xpActivity.userId, userId),
          eq(xpActivity.type, type)
        ));
      
      return result[0]?.total || 0;
    } catch (error) {
      console.error(`Failed to get total XP for user with id ${userId} and type ${type}`, error);
      throw error;
    }
  }

  async getAllActivities() {
    try {
      return await db.select()
        .from(xpActivity)
        .orderBy(xpActivity.createdAt);
    } catch (error) {
      console.error('Failed to get all activities', error);
      throw error;
    }
  }

  async getUserWithActivities(userId: string): Promise<{ user: User, activities: any[] }> {
    try {
      const userData = await db.select().from(user).where(eq(user.id, userId));
      if (!userData.length) {
        throw new Error(`User with id ${userId} not found`);
      }
      
      const activities = await this.getActivitiesByUser(userId);
      
      return { 
        user: userData[0], 
        activities 
      };
    } catch (error) {
      console.error(`Failed to get user with activities for user id ${userId}`, error);
      throw error;
    }
  }
}