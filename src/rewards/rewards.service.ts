import { Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import db from '../../drizzle';
import { reward, userReward, user, type Reward, type UserReward } from '../../lib/db/schema';

@Injectable()
export class RewardsService {
  async createReward(data: { 
    type:'certificate' | 'points'
    title: string; 
    description: string;
    imageUrl?: string;
  }): Promise<Reward> {
    try {
      const [newReward] = await db.insert(reward).values(data).returning();
      return newReward;
    } catch (error) {
      console.error('Failed to create reward', error);
      throw error;
    }
  }

  async getAllRewards(): Promise<Reward[]> {
    try {
      return await db.select().from(reward);
    } catch (error) {
      console.error('Failed to get all rewards', error);
      throw error;
    }
  }

  async getRewardById(id: string): Promise<Reward | null> {
    try {
      const results = await db.select().from(reward).where(eq(reward.id, id));
      return results[0] || null;
    } catch (error) {
      console.error(`Failed to get reward with id ${id}`, error);
      throw error;
    }
  }

  async updateReward(id: string, data: Partial<Omit<Reward, 'id' | 'createdAt'>>): Promise<Reward | null> {
    try {
      const [updatedReward] = await db
        .update(reward)
        .set(data)
        .where(eq(reward.id, id))
        .returning();
      return updatedReward || null;
    } catch (error) {
      console.error(`Failed to update reward with id ${id}`, error);
      throw error;
    }
  }

  async deleteReward(id: string): Promise<boolean> {
    try {
      // First delete all user_reward relationships
      await db.delete(userReward).where(eq(userReward.rewardId, id));
      
      // Then delete the reward
      const result = await db.delete(reward).where(eq(reward.id, id)).returning();
      return result.length > 0;
    } catch (error) {
      console.error(`Failed to delete reward with id ${id}`, error);
      throw error;
    }
  }

  // User-Reward Management
  async awardRewardToUser(userId: string, rewardId: string): Promise<UserReward> {
    try {
      // Check if user exists
      const userExists = await db.select().from(user).where(eq(user.id, userId));
      if (!userExists.length) {
        throw new Error(`User with id ${userId} not found`);
      }
      
      // Check if reward exists
      const rewardExists = await db.select().from(reward).where(eq(reward.id, rewardId));
      if (!rewardExists.length) {
        throw new Error(`Reward with id ${rewardId} not found`);
      }
      
      // Check if user already has this reward
      const existingAward = await db.select()
        .from(userReward)
        .where(and(
          eq(userReward.userId, userId),
          eq(userReward.rewardId, rewardId)
        ));
        
      if (existingAward.length) {
        throw new Error(`User already has this reward`);
      }
      
      // Award the reward to the user
      const [newUserReward] = await db.insert(userReward)
        .values({
          userId,
          rewardId,
          earnedAt: new Date()
        })
        .returning();
        
      return newUserReward;
    } catch (error) {
      console.error(`Failed to award reward to user`, error);
      throw error;
    }
  }

  async getUserCertificateCount(userId: string): Promise<number> {
    try {
      // Get count of certificates earned by the user
      const result = await db
        .select({ count: sql`count(*)` })
        .from(userReward)
        .innerJoin(reward, eq(userReward.rewardId, reward.id))
        .where(and(
          eq(userReward.userId, userId),
          eq(reward.type, 'certificate')
        ));
        
      return Number(result[0].count) || 0;
    } catch (error) {
      console.error(`Failed to get certificate count for user with id ${userId}`, error);
      throw error;
    }
  }

  async getUserRewards(userId: string): Promise<Reward[]> {
    try {
      // Join the userReward and reward tables to get reward details
      const results = await db
        .select({
          id: reward.id,
          type: reward.type,
          title: reward.title,
          description: reward.description,
          imageUrl: reward.imageUrl,
          createdAt: reward.createdAt,
          earnedAt: userReward.earnedAt
        })
        .from(userReward)
        .innerJoin(reward, eq(userReward.rewardId, reward.id))
        .where(eq(userReward.userId, userId));
        
      return results;
    } catch (error) {
      console.error(`Failed to get rewards for user with id ${userId}`, error);
      throw error;
    }
  }

  async removeRewardFromUser(userId: string, rewardId: string): Promise<boolean> {
    try {
      const result = await db
        .delete(userReward)
        .where(and(
          eq(userReward.userId, userId),
          eq(userReward.rewardId, rewardId)
        ))
        .returning();
        
      return result.length > 0;
    } catch (error) {
      console.error(`Failed to remove reward from user`, error);
      throw error;
    }
  }

  async getUsersWithReward(rewardId: string): Promise<{ userId: string; name: string; email: string; earnedAt: Date }[]> {
    try {
      const results = await db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          earnedAt: userReward.earnedAt
        })
        .from(userReward)
        .innerJoin(user, eq(userReward.userId, user.id))
        .where(eq(userReward.rewardId, rewardId));
        
      return results;
    } catch (error) {
      console.error(`Failed to get users with reward id ${rewardId}`, error);
      throw error;
    }
  }
}