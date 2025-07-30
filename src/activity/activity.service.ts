import { Injectable } from '@nestjs/common';
import db from '../../drizzle';
import { eq, and, sql } from 'drizzle-orm';
import { xpActivity, user, type User } from '../../lib/db/schema';

@Injectable()
export class ActivityService {
  async createActivity(data: { 
    userId: string; 
    type: 'quiz' | 'chat' | 'streak';
    xpEarned: number;
  }) {
    try {
      const [newActivity] = await db.insert(xpActivity).values({
        userId: data.userId,
        type: data.type,
        xpEarned: data.xpEarned,
      }).returning();
    await db.update(user)
      .set({ 
        xp: sql`${user.xp} + ${data.xpEarned}` 
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