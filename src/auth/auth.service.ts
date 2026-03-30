import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { eq, desc, ilike, or, inArray } from 'drizzle-orm';
import db from '../../drizzle';
import {
  user,
  type User,
  message,
  chat,
  xpActivity,
  userReward,
  earning,
  roadmap,
  premiumTransactions,
  roadMapStep,
  publicQuiz,
  flashcardDeck,
  roomMessage,
  messageReaction,
  mention,
  community_members,
  community_join_request,
  notifications,
  feedback,
  userFollows,
  weeklyLeaderboard,
  claim,
} from '../../lib/db/schema';
import { signUpDetails, OAuthUserData, OAuthCallbackResult } from 'types/auth';
import { generateReferralCode } from 'lib/constants';
import { UUID } from 'crypto';
import { ActivityService } from 'src/activity/activity.service';
import { WalletService } from 'src/wallet/wallet.service';
import { RewardsService } from 'src/rewards/rewards.service';
import { CronTasksService } from 'src/cron-tasks/cron-tasks.service';
import { ResendService } from 'src/resend/resend.service';
import { supabaseAdmin } from '../../lib/supabase';
import { RoadmapService } from 'src/roadmap/roadmap.service';
import { CommunityService } from 'src/community/community.service';
import { update } from '@metaplex-foundation/mpl-core';
import { SocialService } from 'src/social/social.service';
import { LeaderboardService } from 'src/leaderboard/leaderboard.service';
import resend from 'resend';

export interface UserResponse extends User {
  quizLimit: number;
}

@Injectable()
export class AuthService {
  constructor(
    private activityService: ActivityService,
    @Inject(forwardRef(() => WalletService))
    private walletService: WalletService,
    private rewardService: RewardsService,
    @Inject(forwardRef(() => CronTasksService))
    private cronTasksService: CronTasksService,
    private resendService: ResendService,
    private roadmapService: RoadmapService,
    private communityService: CommunityService,
    @Inject(forwardRef(() => SocialService))
    private socialService: SocialService,
    private leaderboardService: LeaderboardService,
  ) {}
  async createUser(data: signUpDetails): Promise<UserResponse | Error> {
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

      const referredByCode = data.referredBy || data.referralCode;

      await db.insert(user).values({
        id: data.id as UUID,
        name: data.name,
        email: data.email,
        referralCode: referralCode,
        referredBy: referredByCode,
        username: data.username || '',
        address: userWallet.publicKey,
        encryptedPrivateKey: userWallet.encryptedSecret,
      });

      if (referredByCode && referredByCode.trim() !== '') {
        try {
          const referringUsers = await db
            .select()
            .from(user)
            .where(eq(user.referralCode, referredByCode));

          console.log(
            `Found ${referringUsers.length} user(s) with referral code: ${referredByCode}`,
          );

          if (referringUsers.length > 0) {
            const referringUser = referringUsers[0];
            const currentReferralCount = referringUser.referralCount || 0;

            console.log(
              `Incrementing referral count for user ${referringUser.email} from ${currentReferralCount} to ${currentReferralCount + 1}`,
            );

            await db
              .update(user)
              .set({ referralCount: currentReferralCount + 1 })
              .where(eq(user.referralCode, referredByCode));

            await db
              .update(user)
              .set({ xp: referringUser.xp + 5 })
              .where(eq(user.referralCode, referredByCode));

            console.log(
              `Successfully updated referral count and XP for referring user ${referringUser.email}`,
            );
          } else {
            console.log(`No user found with referral code: ${referredByCode}`);
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

      this.resendService
        .addResendContact(createdUser.email, createdUser.name)
        .catch((error) => {
          console.error('Failed to add resend contact:', error);
        });

      this.resendService
        .sendWelcomeEmail(
          createdUser.email,
          createdUser.name,
          createdUser.username || '',
          createdUser.referralCode || '',
        )
        .catch((error) => {
          console.error('Failed to send welcome email:', error);
        });

      return {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        username: createdUser.username,
        learning: createdUser.learning,
        verified: createdUser.verified,
        level: createdUser.level,
        xp: createdUser.xp,
        address: createdUser.address,
        credits: createdUser.credits,
        isPremium: createdUser.isPremium,
        premiumUntil: createdUser.premiumUntil,
        streak: createdUser.streak,
        referralCode: createdUser.referralCode,
        lastLoggedIn: createdUser.lastLoggedIn,
        profilePictureURL: createdUser.profilePictureURL,
        quizLimit: createdUser.quizLimits,
      } as UserResponse;
    } catch (error) {
      console.error('❌ Failed to create user in database:', error);
      console.error('Error details:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint,
      });

      console.log('🔄 ROLLBACK: Checking for Supabase Auth user to delete...');
      try {
        const { data: authUsersData, error: listError } =
          await supabaseAdmin.auth.admin.listUsers();

        if (listError) {
          console.error('⚠️ Error listing Supabase Auth users:', listError);
        } else {
          const matchingUser = authUsersData?.users?.find(
            (u: any) => u.email?.toLowerCase() === data.email.toLowerCase(),
          );

          if (matchingUser) {
            const supabaseUserId = matchingUser.id;
            console.log(
              `🔄 ROLLBACK: Found Supabase Auth user (${supabaseUserId}), deleting...`,
            );

            const { error: deleteError } =
              await supabaseAdmin.auth.admin.deleteUser(supabaseUserId);
            if (deleteError) {
              console.error(
                '⚠️ Failed to delete Supabase Auth user during rollback:',
                deleteError,
              );
            } else {
              console.log(
                '✅ Successfully deleted Supabase Auth user during rollback',
              );
            }
          } else {
            console.log('✅ No Supabase Auth user found - nothing to rollback');
          }
        }
      } catch (rollbackErr) {
        console.error(
          '❌ Error during Supabase Auth rollback check:',
          rollbackErr,
        );
      }

      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<UserResponse | null> {
    try {
      const result = await db.select().from(user).where(eq(user.email, email));

      const userObject = {
        id: result[0]?.id,
        name: result[0]?.name,
        email: result[0]?.email,
        username: result[0]?.username,
        learning: result[0]?.learning,
        verified: result[0]?.verified,
        level: result[0]?.level,
        xp: result[0]?.xp,
        address: result[0]?.address,
        credits: result[0]?.credits,
        isPremium: result[0]?.isPremium,
        premiumUntil: result[0]?.premiumUntil,
        streak: result[0]?.streak,
        referralCode: result[0]?.referralCode,
        lastLoggedIn: result[0]?.lastLoggedIn,
        profilePictureURL: result[0]?.profilePictureURL,
        quizLimit: result[0]?.quizLimits,
      };
      return (userObject as UserResponse) || null;
    } catch (error) {
      console.error('Failed to get user by email');
      throw error;
    }
  }

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

  async checkUserAvailability(
    email?: string,
    username?: string,
  ): Promise<{
    emailAvailable: boolean;
    usernameAvailable: boolean;
    message?: string;
  }> {
    try {
      let emailAvailable = true;
      let usernameAvailable = true;
      const messages: string[] = [];

      if (email) {
        const existingUserByEmail = await db
          .select()
          .from(user)
          .where(eq(user.email, email))
          .limit(1);

        if (existingUserByEmail.length > 0) {
          emailAvailable = false;
          messages.push('Email is already registered');
        }
      }

      if (username) {
        const existingUserByUsername = await db
          .select()
          .from(user)
          .where(eq(user.username, username))
          .limit(1);

        if (existingUserByUsername.length > 0) {
          usernameAvailable = false;
          messages.push('Username is already taken');
        }
      }

      return {
        emailAvailable,
        usernameAvailable,
        message: messages.length > 0 ? messages.join('. ') : undefined,
      };
    } catch (error) {
      console.error('Failed to check user availability:', error);
      throw error;
    }
  }
  async getUserByAddress(address: string): Promise<User | null> {
    try {
      const result = await db
        .select()
        .from(user)
        .where(eq(user.address, address));
      if (!result[0]) return null;

      return {
        ...result[0],
        quizLimit: result[0].quizLimits,
      } as any;
    } catch (error) {
      console.error('Failed to get user by address');
      throw error;
    }
  }
  async editUser({
    name,
    email,
    username,
    learning,
  }: {
    name: string;
    email: string;
    username: string;
    learning: string;
  }): Promise<User | null> {
    try {
      const result = await db
        .update(user)
        .set({ name, username, learning })
        .where(eq(user.email, email))
        .returning();

      const updatedUser = result[0] ?? null;

      if (updatedUser && learning && learning.trim() !== '') {
        this.roadmapService
          .generateRoadmap(updatedUser.id, learning.trim())
          .catch((error) => {
            console.error('Failed to generate roadmap:', error);
          });

        this.resendService
          .sendRoadmapGeneratedEmail(
            updatedUser.email,
            learning.trim(),
            updatedUser.username || '',
          )
          .catch((error) => {
            console.error('Failed to send roadmap generated email:', error);
          });
      }

      if (!updatedUser) return null;

      return {
        ...updatedUser,
        quizLimit: updatedUser.quizLimits,
      } as any;
    } catch (error) {
      console.error('Failed to edit user');
      throw error;
    }
  }

  async updateUserProfilePicture(email: string, profilePictureURL: string) {
    try {
      return await db
        .update(user)
        .set({ profilePictureURL })
        .where(eq(user.email, email));
    } catch (error) {
      console.error('Failed to update user profile picture');
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

  async deductUserCredits(
    userId: string,
    amount: number = 0.5,
  ): Promise<number> {
    try {
      const users = await db.select().from(user).where(eq(user.id, userId));
      if (users.length === 0) {
        throw new Error(`User with id ${userId} not found`);
      }

      const currentUser = users[0];
      const currentCredits = Number(currentUser.credits);
      const newCredits = currentCredits - amount;
      if (newCredits < 0) {
        throw new Error('Insufficient credits');
      }

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
        id: u.id,
        name: u.name,
        xp: u.xp,
        email: u.email,
        level: u.level,
        profilePictureURL: u.profilePictureURL,
      }));
    } catch (error) {
      console.error('Failed to get all users from database');
      throw error;
    }
  }

  async getWeeklyLeaderboard(weekStart?: Date) {
    return this.leaderboardService.getWeeklyLeaderboard(weekStart);
  }

  async updateUserExpoPushToken(userId: string, expoPushToken: string) {
    try {
      const updatedUser = await db
        .update(user)
        .set({ expoPushToken })
        .where(eq(user.id, userId))
        .returning();

      if (!updatedUser || updatedUser.length === 0) {
        throw new Error(`User not found with id: ${userId}`);
      }

      console.log(
        `✅ User expo push token updated successfully for user ${userId}: ${updatedUser[0]?.expoPushToken}`,
      );
      return updatedUser[0];
    } catch (error) {
      console.error('❌ Failed to update user expo push token:', error);
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
        xpEarned: xp,
      });

      await this.leaderboardService.trackWeeklyXP(userId, xp);

      let newLevel = 'novice';
      const oldLevel = currentUser.level;

      if (newXP >= 5000) {
        newLevel = 'expert';
      } else if (newXP >= 3000) {
        newLevel = 'advanced';
      } else if (newXP >= 1500) {
        newLevel = 'intermediate';
      } else if (newXP >= 500) {
        newLevel = 'beginner';
        console.log(
          `User ${userId} reached ${newXP} XP - awarding beginner NFT reward`,
        );
        try {
          await this.rewardService.awardRewardToUser(
            userId,
            'ab2cf73e-57bf-4820-a46a-684cab23b1b4',
          );
          console.log(`Successfully awarded beginner NFT to user ${userId}`);
        } catch (error) {
          if (
            error.message &&
            error.message.includes('already has this reward')
          ) {
            console.log(`User ${userId} already has the beginner NFT reward`);
          } else {
            console.error(
              `Failed to award beginner NFT to user ${userId}:`,
              error,
            );
          }
        }
      }
      const levels = [
        'novice',
        'beginner',
        'intermediate',
        'advanced',
        'expert',
      ];
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

      try {
        await this.communityService.updateModStatusBasedOnXP(userId);
      } catch (error) {
        console.error('Failed to update mod status after XP change:', error);
      }

      if (oldLevel !== newLevel) {
        try {
          await this.socialService.notifyFollowers(userId, {
            type: 'level_up',
            data: {
              level: levels[levels.indexOf(newLevel)],
              levelTitle: title,
              xpTotal: newXP,
            },
          });
        } catch (notifyError) {
          console.error(
            'Failed to notify followers about level change:',
            notifyError,
          );
        }
      }

      return { level: newLevel, xp: newXP };
    } catch (error) {
      console.error('Failed to update user XP in database', error);
      throw error;
    }
  }

  async updateUserStreak(
    userId: string,
    clientStreak: number,
  ): Promise<number> {
    try {
      const users = await db.select().from(user).where(eq(user.id, userId));
      if (users.length === 0) {
        throw new Error(`User with id ${userId} not found`);
      }

      const currentUser = users[0];
      const now = new Date();
      const todayMidnight = new Date(now);
      todayMidnight.setHours(0, 0, 0, 0);
      const lastLogin = currentUser.lastLoggedIn
        ? new Date(currentUser.lastLoggedIn)
        : now;
      lastLogin.setHours(0, 0, 0, 0);
      const daysSinceLogin = Math.floor(
        (todayMidnight.getTime() - lastLogin.getTime()) / (1000 * 60 * 60 * 24),
      );

      let newStreak = clientStreak;
      if (daysSinceLogin > 1 && clientStreak === 1) {
        const shieldActive =
          currentUser.streakShieldActive &&
          currentUser.streakShieldExpiry &&
          new Date(currentUser.streakShieldExpiry) > now;
        if (shieldActive) {
          newStreak = currentUser.streak || 1;
          await db
            .update(user)
            .set({ streakShieldActive: false, streakShieldExpiry: null })
            .where(eq(user.id, userId));
        }
      }

      await db
        .update(user)
        .set({ streak: newStreak, lastLoggedIn: now })
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

      const oldLevel = users[0].level;
      await db.update(user).set({ level }).where(eq(user.id, userId));

      if (oldLevel !== level) {
        try {
          await this.socialService.notifyFollowers(userId, {
            type: 'level_up',
            data: { level },
          });
        } catch (notifyError) {
          console.error(
            'Failed to notify followers about level change:',
            notifyError,
          );
        }
      }

      return level;
    } catch (error) {
      console.error('Failed to set user level', error);
      throw error;
    }
  }

  async renewUserCredits(userId: string): Promise<number> {
    try {
      const users = await db.select().from(user).where(eq(user.id, userId));
      if (users.length === 0) {
        throw new Error(`User with id ${userId} not found`);
      }

      const currentUser = users[0];
      const currentCredits = Number(currentUser.credits || 0);
      const now = new Date();
      const todayMidnight = new Date(now);
      todayMidnight.setHours(0, 0, 0, 0);
      const lastRenewalMidnight = currentUser.lastCreditRenewal
        ? new Date(currentUser.lastCreditRenewal)
        : new Date(0);
      lastRenewalMidnight.setHours(0, 0, 0, 0);

      if (lastRenewalMidnight.getTime() < todayMidnight.getTime()) {
        const newCredits = currentUser.isPremium ? currentCredits + 20 : 10;
        const newUploadLimit = currentUser.isPremium ? 5 : 2;

        await db
          .update(user)
          .set({
            credits: newCredits.toString(),
            lastCreditRenewal: now,
          })
          .where(eq(user.id, userId));

        await db
          .update(user)
          .set({ imageUploadLimit: newUploadLimit })
          .where(eq(user.id, userId));

        const newQuizLimits = currentUser.isPremium ? 15 : 5;
        await db
          .update(user)
          .set({ quizLimits: newQuizLimits })
          .where(eq(user.id, userId));

        return newCredits;
      }
      return currentCredits;
    } catch (error) {
      console.error('Failed to renew user credits', error);
      throw error;
    }
  }

  async updateUserPremiumStatus(
    userId: string,
    isPremium: boolean,
  ): Promise<boolean> {
    try {
      const users = await db.select().from(user).where(eq(user.id, userId));
      if (users.length === 0) {
        throw new Error(`User with id ${userId} not found`);
      }

      const now = new Date();
      const premiumUntil = new Date(now);
      premiumUntil.setMonth(now.getMonth() + 1);

      await db
        .update(user)
        .set({
          isPremium,
          premiumUntil: isPremium ? premiumUntil : null,
        })
        .where(eq(user.id, userId));

      return isPremium;
    } catch (error) {
      console.error('Failed to update user premium status', error);
      throw error;
    }
  }
  async incrementCredits(userId: string, amount: number): Promise<number> {
    try {
      const users = await db.select().from(user).where(eq(user.id, userId));
      if (users.length === 0) {
        throw new Error(`User with id ${userId} not found`);
      }

      const currentUser = users[0];
      const currentCredits = Number(currentUser.credits || 0);
      const newCredits = currentCredits + amount;

      await db
        .update(user)
        .set({ credits: newCredits.toString() })
        .where(eq(user.id, userId));

      return newCredits;
    } catch (error) {
      console.error('Failed to increment user credits', error);
      throw error;
    }
  }

  async verifyUser(email: string): Promise<User | null> {
    try {
      const result = await db
        .update(user)
        .set({ verified: true })
        .where(eq(user.email, email))
        .returning();

      if (!result[0]) return null;

      return {
        ...result[0],
        quizLimit: result[0].quizLimits,
      } as any;
    } catch (error) {
      console.error('Failed to verify user', error);
      throw error;
    }
  }

  async searchUsersByUsername(
    usernameQuery: string,
    limit: number = 10,
  ): Promise<Partial<User>[]> {
    try {
      const results = await db
        .select({
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          verified: user.verified,
          level: user.level,
          xp: user.xp,
          address: user.address,
          learning: user.learning,
          profilePictureURL: user.profilePictureURL,
          streak: user.streak,
        })
        .from(user)
        .where(ilike(user.username, `%${usernameQuery}%`))
        .limit(limit)
        .orderBy(desc(user.xp));

      return results;
    } catch (error) {
      console.error('Failed to search users by username', error);
      throw error;
    }
  }

  async deductQuizLimit(userId: string): Promise<number> {
    try {
      const users = await db.select().from(user).where(eq(user.id, userId));
      if (users.length === 0) {
        throw new Error(`User with id ${userId} not found`);
      }

      const currentUser = users[0];
      const currentQuizLimits = currentUser.quizLimits || 0;
      if (currentQuizLimits <= 0) {
        throw new Error('No quiz attempts left for today');
      }
      const newQuizLimits = currentQuizLimits - 1;

      await db
        .update(user)
        .set({ quizLimits: newQuizLimits })
        .where(eq(user.id, userId));
      return newQuizLimits;
    } catch (error) {
      console.error('Failed to deduct quiz limit', error);
      throw error;
    }
  }

  async getUserByRefCode(referralCode: string): Promise<User> {
    try {
      const affiliate = await db
        .select()
        .from(user)
        .where(eq(user.referralCode, referralCode));

      if (affiliate.length === 0) {
        throw new Error(`User with referral code ${referralCode} not found`);
      }

      return {
        ...affiliate[0],
        quizLimit: affiliate[0].quizLimits,
      } as any;
    } catch (error) {
      console.error('Failed to get user by referral code', error);
      throw error;
    }
  }

  async deleteUserDataAsync(
    userId: string,
    supabaseUserId: string,
  ): Promise<{ message: string; deletionStarted: boolean }> {
    try {
      const userToDelete = await this.getUserById(userId);
      if (!userToDelete) {
        throw new Error(`User with id ${userId} not found`);
      }

      this.deleteUserData(userId, supabaseUserId).catch((error) => {
        console.error(`Background deletion failed for user ${userId}:`, error);
      });

      return {
        message:
          'User deletion process has been initiated and will complete in the background',
        deletionStarted: true,
      };
    } catch (error) {
      console.error('Failed to initiate user deletion', error);
      throw error;
    }
  }

  async deleteUserData(
    userId: string,
    supabaseUserId: string,
  ): Promise<boolean> {
    try {
      console.log(`Starting deletion process for user: ${supabaseUserId}`);
      try {
        const { error: supabaseError } =
          await supabaseAdmin.auth.admin.deleteUser(supabaseUserId as UUID);
        if (supabaseError) {
          console.error(
            `Failed to delete user from Supabase Auth: ${supabaseError.message}`,
          );
        } else {
          console.log(
            `Successfully deleted user from Supabase Auth: ${supabaseUserId}`,
          );
        }
      } catch (supabaseError) {
        console.error(`Error deleting user from Supabase Auth:`, supabaseError);
      }

      const userRoadmaps = await db
        .select()
        .from(roadmap)
        .where(eq(roadmap.userId, userId));
      console.log(`Found ${userRoadmaps.length} roadmaps for user ${userId}`);

      for (const userRoadmap of userRoadmaps) {
        await db
          .delete(roadMapStep)
          .where(eq(roadMapStep.roadmapId, userRoadmap.id));
        console.log(`Deleted roadmap steps for roadmap ${userRoadmap.id}`);
      }
      const userChats = await db
        .select()
        .from(chat)
        .where(eq(chat.userId, userId));
      console.log(`Found ${userChats.length} chats for user ${userId}`);

      await db.delete(publicQuiz).where(eq(publicQuiz.createdBy, userId));
      const chatIds = userChats.map((c) => c.id);
      if (chatIds.length > 0) {
        await db
          .update(publicQuiz)
          .set({ sourceChatId: null })
          .where(inArray(publicQuiz.sourceChatId, chatIds));
      }

      const userRoomMsgs = await db
        .select({ id: roomMessage.id })
        .from(roomMessage)
        .where(eq(roomMessage.userId, userId));
      const roomMsgIds = userRoomMsgs.map((r) => r.id);
      if (roomMsgIds.length > 0) {
        await db
          .delete(messageReaction)
          .where(
            or(
              eq(messageReaction.userId, userId),
              inArray(messageReaction.messageId, roomMsgIds),
            ),
          );
        await db
          .delete(mention)
          .where(
            or(
              eq(mention.mentionedUserId, userId),
              inArray(mention.messageId, roomMsgIds),
            ),
          );
      } else {
        await db
          .delete(messageReaction)
          .where(eq(messageReaction.userId, userId));
        await db.delete(mention).where(eq(mention.mentionedUserId, userId));
      }
      await db.delete(roomMessage).where(eq(roomMessage.userId, userId));

      await db.delete(flashcardDeck).where(eq(flashcardDeck.userId, userId));

      await db
        .delete(community_members)
        .where(eq(community_members.userId, userId));
      await db
        .delete(community_join_request)
        .where(eq(community_join_request.userId, userId));
      await db.delete(notifications).where(eq(notifications.userId, userId));
      await db
        .update(feedback)
        .set({ reviewedBy: null })
        .where(eq(feedback.reviewedBy, userId));
      await db.delete(feedback).where(eq(feedback.userId, userId));
      await db
        .delete(userFollows)
        .where(
          or(
            eq(userFollows.followerId, userId),
            eq(userFollows.followingId, userId),
          ),
        );
      await db
        .delete(weeklyLeaderboard)
        .where(eq(weeklyLeaderboard.userId, userId));

      const [userRow] = await db
        .select({ address: user.address })
        .from(user)
        .where(eq(user.id, userId));
      if (userRow?.address) {
        await db.delete(claim).where(eq(claim.wallet, userRow.address));
      }

      for (const userChat of userChats) {
        await db.delete(message).where(eq(message.chatId, userChat.id));
        console.log(`Deleted messages for chat ${userChat.id}`);
      }
      await db.delete(roadmap).where(eq(roadmap.userId, userId));
      console.log(`Deleted ${userRoadmaps.length} roadmaps for user ${userId}`);

      await db.delete(chat).where(eq(chat.userId, userId));
      console.log(`Deleted ${userChats.length} chats for user ${userId}`);

      await db.delete(xpActivity).where(eq(xpActivity.userId, userId));
      console.log(`Deleted XP activities for user ${userId}`);

      await db.delete(userReward).where(eq(userReward.userId, userId));
      console.log(`Deleted user rewards for user ${userId}`);

      await db.delete(earning).where(eq(earning.userId, userId));
      console.log(`Deleted earnings for user ${userId}`);

      await db
        .delete(premiumTransactions)
        .where(eq(premiumTransactions.userId, userId));
      console.log(`Deleted premium transactions for user ${userId}`);

      await db.delete(user).where(eq(user.id, userId));
      console.log(`Successfully deleted user from database: ${userId}`);

      return true;
    } catch (error) {
      console.error('Failed to delete user data', error);
      throw error;
    }
  }

  async getUserByEmailOrProviderId(
    email: string,
    providerId: string,
  ): Promise<User | null> {
    const byProviderId = await db
      .select()
      .from(user)
      .where(eq(user.oauthProviderId, providerId))
      .limit(1);

    if (byProviderId[0]) {
      return {
        ...byProviderId[0],
        quizLimit: byProviderId[0].quizLimits,
      } as any;
    }

    const byEmail = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (!byEmail[0]) return null;

    return {
      ...byEmail[0],
      quizLimit: byEmail[0].quizLimits,
    } as any;
  }

  async handleOAuthUser(data: OAuthUserData): Promise<OAuthCallbackResult> {
    const existingUser = await this.getUserByEmailOrProviderId(
      data.email,
      data.providerId,
    );
    if (existingUser) {
      if (!existingUser.oauthProvider || !existingUser.oauthProviderId) {
        await db
          .update(user)
          .set({
            oauthProvider: data.provider,
            oauthProviderId: data.providerId,
            lastLoggedIn: new Date(),
          })
          .where(eq(user.id, existingUser.id));

        const updatedUser = await this.getUserById(existingUser.id);
        return {
          user: updatedUser,
          isNewUser: false,
          needsUsername: false,
        };
      }

      await db
        .update(user)
        .set({ lastLoggedIn: new Date() })
        .where(eq(user.id, existingUser.id));

      return {
        user: existingUser,
        isNewUser: false,
        needsUsername: false,
      };
    }

    const tempUsername = this.generateTempUsername(data.email);

    const newUser = await this.createOAuthUser({
      id: data.id,
      name: data.name,
      email: data.email,
      username: tempUsername,
      oauthProvider: data.provider,
      oauthProviderId: data.providerId,
      hasCompletedProfile: false,
    });

    return { user: newUser, isNewUser: true, needsUsername: false };
  }

  private generateTempUsername(email: string): string {
    const emailPrefix = email
      .split('@')[0]
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    return `${emailPrefix}_${randomSuffix}`;
  }

  async createOAuthUser(data: signUpDetails): Promise<User | Error> {
    try {
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
        username: data.username,
        address: userWallet.publicKey,
        encryptedPrivateKey: userWallet.encryptedSecret,
        oauthProvider: data.oauthProvider,
        oauthProviderId: data.oauthProviderId,
        hasCompletedProfile: data.hasCompletedProfile ?? false,
      });

      const [createdUser] = await db
        .select()
        .from(user)
        .where(eq(user.email, data.email));

      this.resendService
        .sendWelcomeEmail(
          createdUser.email,
          createdUser.name,
          createdUser.username || '',
          createdUser.referralCode || '',
        )
        .catch((error) => {
          console.error('Failed to send welcome email:', error);
        });

      return {
        ...createdUser,
        quizLimit: createdUser.quizLimits,
      } as any;
    } catch (error) {
      console.error('Failed to create OAuth user:', error);
      throw error;
    }
  }

  async updateUsername(userId: string, username: string): Promise<User | null> {
    try {
      const result = await db
        .update(user)
        .set({
          username: username,
          hasCompletedProfile: true,
        })
        .where(eq(user.id, userId))
        .returning();

      const updatedUser = result[0] ?? null;

      if (updatedUser && username && username.trim() !== '') {
        try {
          const axios = require('axios');
          const bearerToken = process.env.TWITTER_BEARER_TOKEN;
          if (bearerToken) {
            const response = await axios.get(
              `https://api.twitter.com/2/users/by/username/${username}`,
              {
                headers: {
                  Authorization: `Bearer ${bearerToken}`,
                },
                params: {
                  'user.fields': 'profile_image_url',
                },
              },
            );

            if (response.data?.data?.profile_image_url) {
              const profilePictureURL = response.data.data.profile_image_url;
              await db
                .update(user)
                .set({ profilePictureURL })
                .where(eq(user.id, userId));
            }
          }
        } catch (error) {
          console.error(
            'Failed to fetch Twitter profile picture:',
            error.response?.data || error.message,
          );
        }
      }

      if (!updatedUser) return null;

      return {
        ...updatedUser,
        quizLimit: updatedUser.quizLimits,
      } as any;
    } catch (error) {
      console.error('Failed to update username', error);
      throw error;
    }
  }
}
