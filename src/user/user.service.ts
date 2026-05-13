import { Injectable } from '@nestjs/common';
import { User, user, userReward } from 'lib/db/schema';
import db from '../../drizzle';
import { count, eq } from 'drizzle-orm';

@Injectable()
export class UserService {
  async getUserById(id: string): Promise<User | null> {
    try {
      const result = await db.select({
        id: user.id,
        address: user.address,
        xp: user.xp,
        credits: user.credits,
        name: user.name,
        email: user.email,
        lastLoggedIn: user.lastLoggedIn,
        streak: user.streak,
        referralCode: user.referralCode,
        quizLimits: user.quizLimits,
        quizCompleted: user.quizCompleted,
        isPremium: user.isPremium,
        premiumUntil: user.premiumUntil,
        verified: user.verified,
        profilePictureURL: user.profilePictureURL,
      }).from(user).where(eq(user.id, id)).limit(1);
      if (!result.length) return null;

      const [{ count: nftCount }] = await db
      .select({
        count: count(),
      })
      .from(userReward)
      .where(eq(userReward.userId, id));

      return {
        ...result[0],
        quizLimit: result[0].quizLimits,
        nfts: nftCount,
      } as any;
    } catch (error) {
      console.error('Failed to get user by ID');
      throw error;
    }
  }


  async getUserMemory(userId: string): Promise<string> {
    const [result] = await db.select({ memory: user.memory }).from(user).where(eq(user.id, userId));
    return result?.memory ?? '';
  }

  async updateUserMemory(userId: string, memory: string): Promise<string> {
    await db.update(user).set({ memory: memory }).where(eq(user.id, userId));
    return memory;
  }


}
