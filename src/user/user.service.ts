import { Injectable } from '@nestjs/common';
import { User, user } from 'lib/db/schema';
import db from '../../drizzle';
import { eq } from 'drizzle-orm';

@Injectable()
export class UserService {
  async getUserById(userId: string): Promise<User> {
    const [result] = await db.select().from(user).where(eq(user.id, userId));
    if (!result) {
      throw new Error('User not found');
    }
    return result;
  }

  async getUserMemory(userId: string): Promise<string> {
    const [result] = await db.select({memory: user.memory}).from(user).where(eq(user.id, userId));
    return result?.memory ?? '';
  }

  async updateUserMemory(userId: string, memory: string): Promise<string> {
    await db.update(user).set({ memory: memory }).where(eq(user.id, userId));
    return memory;
  }
}
