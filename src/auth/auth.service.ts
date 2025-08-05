import { Injectable } from '@nestjs/common';
import { eq, desc } from 'drizzle-orm';
import db from '../../drizzle';
import { user, claim, type User } from '../../lib/db/schema';
import { signUpDetails } from 'types/auth';
import { generateReferralCode } from 'lib/constants';
import { UUID } from 'crypto';
import { ActivityService } from 'src/activity/activity.service';
import { WalletService } from 'src/wallet/wallet.service';
import { RewardsService } from 'src/rewards/rewards.service';

@Injectable()
export class AuthService {
  constructor(
    private activityService: ActivityService,
    private walletService: WalletService,
    private rewardService: RewardsService,
  ) {}
  async createUser(data: signUpDetails): Promise<User | Error> {
    try {
      console.log('Creating user in database with data:', data);
      const userExists = await db
        .select()
        .from(user)
        .where(eq(user.email, data.email));

      if (userExists[0]) {
        return new Error('User already exists');
      }

      const userWallet = await this.walletService.genereteWallet();

      const referralCode = generateReferralCode();

      await db.insert(user).values({
        id: data.id as UUID,
        name: data.name,
        email: data.email,
        referralCode: referralCode,
        referredBy: data.referredBy,
        username: data.username,
        address: userWallet.publicKey,
        encryptedPrivateKey: userWallet.encryptedSecret,
      });

      if (data.referredBy && data.referredBy.trim() !== '') {
        try {
          const referringUsers = await db
            .select()
            .from(user)
            .where(eq(user.referralCode, data.referredBy!));

          if (referringUsers.length > 0) {
            const referringUser = referringUsers[0];
            const currentReferralCount = referringUser.referralCount || 0;

            await db
              .update(user)
              .set({ referralCount: currentReferralCount + 1 })
              .where(eq(user.referralCode, data.referredBy));

            await db
              .update(user)
              .set({xp: referringUser.xp + 5})
              .where(eq(user.referralCode, data.referredBy));
          }
        } catch (error) {
          console.error(
            'Failed to increment referral count for referring user',
            error,
          );
        }
      }

      const [createdUser] = await db
        .select()
        .from(user)
        .where(eq(user.email, data.email));

      return createdUser;
    } catch (error) {
      console.error('Failed to create user in database');
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const result = await db.select().from(user).where(eq(user.email, email));
      return result[0] ?? null;
    } catch (error) {
      console.error('Failed to get user by email');
      throw error;
    }
  }

  async getUserById(id: string): Promise<User | null> {
    try {
      const result = await db.select().from(user).where(eq(user.id, id));
      return result[0] ?? null;
    } catch (error) {
      console.error('Failed to get user by ID');
      throw error;
    }
  }

  async editUser({
    name,
    email,
  }: {
    name: string;
    email: string;
  }): Promise<User | null> {
    try {
      const result = await db
        .update(user)
        .set({ name })
        .where(eq(user.email, email))
        .returning();

      return result[0] ?? null;
    } catch (error) {
      console.error('Failed to edit user');
      throw error;
    }
  }

  async updateUserAddress(email: string, address: string) {
    try {
      return await db
        .update(user)
        .set({ address })
        .where(eq(user.email, email));
    } catch (error) {
      console.error('Failed to update user address');
      throw error;
    }
  }

  async incrementReferralCount(referralCode: string) {
    try {
      const result = await db
        .select()
        .from(user)
        .where(eq(user.referralCode, referralCode));

      if (!result[0]) return;

      const currentReferralCount = result[0].referralCount || 0;

      await db
        .update(user)
        .set({ referralCount: currentReferralCount + 1 })
        .where(eq(user.referralCode, referralCode));

      return result[0].name;
    } catch (error) {
      console.error('Failed to increment referral count');
      throw error;
    }
  }

  async deductUserCredits(userId: string): Promise<number> {
    try {
      const users = await db.select().from(user).where(eq(user.id, userId));
      if (users.length === 0) {
        throw new Error(`User with id ${userId} not found`);
      }

      const currentUser = users[0];
      const currentCredits = Number(currentUser.credits);
      const newCredits = currentCredits - 0.5;

      await db
        .update(user)
        .set({ credits: newCredits.toString() })
        .where(eq(user.id, userId));

      return newCredits;
    } catch (error) {
      console.error('Failed to deduct user credits', error);
      throw error;
    }
  }

  async getAllUsersAndXP() {
    try {
      const users = await db.select().from(user).orderBy(desc(user.xp));
      return users.map((u) => ({
        name: u.name,
        xp: u.xp,
        email: u.email,
      }));
    } catch (error) {
      console.error('Failed to get all users from database');
      throw error;
    }
  }

  async updateUserXP(
    userId: string,
    title: string,
    xp: number,
    type: 'quiz' | 'chat' | 'streak',
  ): Promise<{ level: string; xp: number }> {
    try {
      const users = await db.select().from(user).where(eq(user.id, userId));
      if (users.length === 0) {
        throw new Error(`User with id ${userId} not found`);
      }

      const currentUser = users[0];
      const newXP = (currentUser.xp || 0) + xp;

      await this.activityService.createActivity({
        userId: currentUser.id,
        type: type,
        title: title,
        xpEarned: newXP,
      });

      let newLevel = 'novice';

      if (newXP >= 5000) {
        newLevel = 'expert';
      } else if (newXP >= 3000) {
        newLevel = 'advanced';
      } else if (newXP >= 1500) {
        newLevel = 'intermediate';
      } else if (newXP >= 500) {
        newLevel = 'beginner';
        console.log(`User ${userId} reached ${newXP} XP - awarding beginner NFT reward`);
        try {
          await this.rewardService.awardRewardToUser(
            userId,
            'ab2cf73e-57bf-4820-a46a-684cab23b1b4',
          );
          console.log(`Successfully awarded beginner NFT to user ${userId}`);
        } catch (error) {
          if (error.message && error.message.includes('already has this reward')) {
            console.log(`User ${userId} already has the beginner NFT reward`);
          } else {
            console.error(`Failed to award beginner NFT to user ${userId}:`, error);
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
        .where(eq(user.id, userId));

      return { level: newLevel, xp: newXP };
    } catch (error) {
      console.error('Failed to update user XP in database', error);
      throw error;
    }
  }

  async updateUserStreak(
    userId: string,
    incrementBy: number = 1,
  ): Promise<number> {
    try {
      const users = await db.select().from(user).where(eq(user.id, userId));
      if (users.length === 0) {
        throw new Error(`User with id ${userId} not found`);
      }

      const currentUser = users[0];
      const currentStreak = currentUser.streak || 0;
      const newStreak = currentStreak + incrementBy;

      await db
        .update(user)
        .set({ streak: newStreak })
        .where(eq(user.id, userId));

      return newStreak;
    } catch (error) {
      console.error('Failed to update user streak', error);
      throw error;
    }
  }

  async setUserLevel(
    userId: string,
    level: 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'expert',
  ): Promise<string> {
    try {
      const users = await db.select().from(user).where(eq(user.id, userId));
      if (users.length === 0) {
        throw new Error(`User with id ${userId} not found`);
      }

      await db.update(user).set({ level }).where(eq(user.id, userId));

      return level;
    } catch (error) {
      console.error('Failed to set user level', error);
      throw error;
    }
  }
}
