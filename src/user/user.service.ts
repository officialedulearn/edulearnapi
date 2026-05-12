import { Injectable } from '@nestjs/common';
import { User, user } from 'lib/db/schema';
import db from '../../drizzle';
import { eq } from 'drizzle-orm';

@Injectable()
export class UserService {
  async getUserById(id: string): Promise<User | null> {
    try {
      const result = await db.select().from(user).where(eq(user.id, id));
      if (!result[0]) return null;

      return {
        ...result[0],
        quizLimit: result[0].quizLimits,
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
