import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import db from '../../drizzle';
import {
  subscription,
  user,
  userReward,
  userSubscription,
} from '../../lib/db/schema';
import { RewardsService } from '../rewards/rewards.service';
import { WalletService } from '../wallet/wallet.service';

export type SubscriptionTier = 'basic' | 'pro' | 'ultra';
export type BillingPeriod = 'monthly' | 'yearly';

export function computeSubscriptionExpiry(
  billingPeriod: BillingPeriod,
  from: Date = new Date(),
): Date {
  const expiry = new Date(from);
  if (billingPeriod === 'yearly') {
    expiry.setFullYear(expiry.getFullYear() + 1);
  } else {
    expiry.setMonth(expiry.getMonth() + 1);
  }
  return expiry;
}

export interface TierBenefits {
  tier: SubscriptionTier;
  name: string;
  description: string;
  priceMonthly: number;
  dailyCredits: number;
  dailyQuizLimit: number;
  dailyImageUploadLimit: number;
  aiModel: string;
  maxRoadmaps: number;
  streakShieldIncluded: boolean;
  prioritySupport: boolean;
  exclusiveBadges: boolean;
  benefits: string[];
}

export const SUBSCRIPTION_TIERS: Record<SubscriptionTier, TierBenefits> = {
  basic: {
    tier: 'basic',
    name: 'Basic',
    description: 'Get started with core learning features for free.',
    priceMonthly: 0,
    dailyCredits: 10,
    dailyQuizLimit: 5,
    dailyImageUploadLimit: 2,
    aiModel: 'gemini-2.5-flash',
    maxRoadmaps: 3,
    streakShieldIncluded: false,
    prioritySupport: false,
    exclusiveBadges: false,
    benefits: [
      '10 daily AI credits',
      '5 daily quiz generations',
      '2 daily image uploads',
      'Up to 3 active roadmaps',
      'Standard AI model (Gemini Flash)',
    ],
  },
  pro: {
    tier: 'pro',
    name: 'Pro',
    description: 'Unlock advanced AI, unlimited roadmaps and a streak shield.',
    priceMonthly: 9.99,
    dailyCredits: 30,
    dailyQuizLimit: 15,
    dailyImageUploadLimit: 5,
    aiModel: 'gemini-2.5-pro',
    maxRoadmaps: -1,
    streakShieldIncluded: true,
    prioritySupport: false,
    exclusiveBadges: true,
    benefits: [
      '30 daily AI credits',
      '15 daily quiz generations',
      '5 daily image uploads',
      'Unlimited roadmaps',
      'Advanced AI model (Gemini Pro)',
      'Monthly streak shield included',
      'Exclusive Pro badge',
    ],
  },
  ultra: {
    tier: 'ultra',
    name: 'Ultra',
    description:
      'The full EduLearn experience — maximum limits and priority access.',
    priceMonthly: 19.99,
    dailyCredits: 100,
    dailyQuizLimit: 50,
    dailyImageUploadLimit: 20,
    aiModel: 'gemini-2.5-pro',
    maxRoadmaps: -1,
    streakShieldIncluded: true,
    prioritySupport: true,
    exclusiveBadges: true,
    benefits: [
      '100 daily AI credits',
      '50 daily quiz generations',
      '20 daily image uploads',
      'Unlimited roadmaps',
      'Advanced AI model (Gemini Pro)',
      'Always-on streak shield',
      'Priority AI inference',
      'Exclusive Ultra badge & cosmetics',
    ],
  },
};

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @Inject(forwardRef(() => RewardsService))
    private readonly rewardsService: RewardsService,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService,
  ) {}

  getAllTiers(): TierBenefits[] {
    return [
      SUBSCRIPTION_TIERS.basic,
      SUBSCRIPTION_TIERS.pro,
      SUBSCRIPTION_TIERS.ultra,
    ];
  }

  async getUserSubscription(userId: string): Promise<{
    tier: SubscriptionTier;
    benefits: TierBenefits;
    isActive: boolean;
    billingPeriod: BillingPeriod | null;
    startedAt: Date | null;
    expiresAt: Date | null;
  }> {
    const rows = await db
      .select({
        tier: subscription.tier,
        billingPeriod: userSubscription.billingPeriod,
        startedAt: userSubscription.startedAt,
        expiresAt: userSubscription.expiresAt,
        isActive: userSubscription.isActive,
      })
      .from(userSubscription)
      .innerJoin(
        subscription,
        eq(userSubscription.subscriptionId, subscription.id),
      )
      .where(
        and(
          eq(userSubscription.userId, userId),
          eq(userSubscription.isActive, true),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return {
        tier: 'basic',
        benefits: SUBSCRIPTION_TIERS.basic,
        isActive: true,
        billingPeriod: null,
        startedAt: null,
        expiresAt: null,
      };
    }

    const row = rows[0];
    const tier = row.tier as SubscriptionTier;
    const expired = row.expiresAt ? row.expiresAt.getTime() < Date.now() : false;

    return {
      tier: expired ? 'basic' : tier,
      benefits: expired
        ? SUBSCRIPTION_TIERS.basic
        : SUBSCRIPTION_TIERS[tier],
      isActive: row.isActive && !expired,
      billingPeriod: row.billingPeriod as BillingPeriod,
      startedAt: row.startedAt,
      expiresAt: row.expiresAt,
    };
  }

  async expireUserSubscriptions(): Promise<{ expiredCount: number }> {
    const now = new Date();
    const expiredRows = await db
      .select({ id: userSubscription.id, userId: userSubscription.userId })
      .from(userSubscription)
      .where(
        and(
          eq(userSubscription.isActive, true),
          lt(userSubscription.expiresAt, now),
        ),
      );

    if (expiredRows.length === 0) {
      this.logger.log('No expired user subscriptions to process');
      return { expiredCount: 0 };
    }

    await db
      .update(userSubscription)
      .set({ isActive: false, updatedAt: now })
      .where(
        and(
          eq(userSubscription.isActive, true),
          lt(userSubscription.expiresAt, now),
        ),
      );

    this.logger.log(
      `Deactivated ${expiredRows.length} expired user subscription(s)`,
    );
    return { expiredCount: expiredRows.length };
  }

  async updateUserPremiumStatus(
    appUserId: string,
    isPremium: boolean,
    expirationDate?: string,
  ): Promise<void> {
    try {
      this.logger.log(
        `Updating premium status for user ${appUserId}: ${isPremium}`,
      );

      const users = await db.select().from(user).where(eq(user.id, appUserId));

      if (users.length === 0) {
        this.logger.error(`User with id ${appUserId} not found`);
        throw new Error(`User with id ${appUserId} not found`);
      }

      const updateData: any = {
        isPremium,
      };

      if (isPremium && expirationDate) {
        updateData.premiumUntil = new Date(expirationDate);
      } else if (!isPremium) {
        updateData.premiumUntil = null;
      } else if (isPremium && !expirationDate) {
        const premiumUntil = new Date();
        premiumUntil.setMonth(premiumUntil.getMonth() + 1);
        updateData.premiumUntil = premiumUntil;
      }

      await db.update(user).set(updateData).where(eq(user.id, appUserId));

      this.logger.log(
        `Successfully updated premium status for user ${appUserId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update premium status for user ${appUserId}`,
        error.stack,
      );
      throw error;
    }
  }

  async handleInitialPurchase(appUserId: string, expirationDate?: string) {
    this.logger.log(`Handling INITIAL_PURCHASE for user ${appUserId}`);
    await this.updateUserPremiumStatus(appUserId, true, expirationDate);
  }

  async handleRenewal(appUserId: string, expirationDate?: string) {
    this.logger.log(`Handling RENEWAL for user ${appUserId}`);
    await this.updateUserPremiumStatus(appUserId, true, expirationDate);
  }

  async handleCancellation(appUserId: string) {
    this.logger.log(`Handling CANCELLATION for user ${appUserId}`);
    this.logger.log(
      `User ${appUserId} cancelled subscription - will remain premium until expiration`,
    );
  }

  async handleBillingIssue(appUserId: string) {
    this.logger.log(`Handling BILLING_ISSUE for user ${appUserId}`);
    this.logger.log(
      `User ${appUserId} has billing issue - keeping premium active during grace period`,
    );
  }

  async handleExpiration(appUserId: string) {
    this.logger.log(`Handling EXPIRATION for user ${appUserId}`);
    await this.updateUserPremiumStatus(appUserId, false);
  }

  async handleProductChange(appUserId: string, expirationDate?: string) {
    this.logger.log(`Handling PRODUCT_CHANGE for user ${appUserId}`);
    await this.updateUserPremiumStatus(appUserId, true, expirationDate);
  }

  async handleBadgeClaim(
    appUserId: string,
    productId: string,
    webhookPayload: any,
  ) {
    try {
      this.logger.log(
        `🎯 Processing badge claim for user ${appUserId}, product: ${productId}, event type: ${webhookPayload?.event?.type}`,
      );

      const users = await db.select().from(user).where(eq(user.id, appUserId));
      if (users.length === 0) {
        this.logger.error(`User ${appUserId} not found for badge claim`);
        throw new Error(`User not found: ${appUserId}`);
      }

      const unclaimedRewards = await db
        .select()
        .from(userReward)
        .where(eq(userReward.userId, appUserId));

      const nextUnclaimedReward = unclaimedRewards.find(
        (reward) => !reward.signature,
      );

      if (!nextUnclaimedReward) {
        this.logger.warn(
          `⚠️ No unclaimed rewards found for user ${appUserId} - may be duplicate webhook or all rewards already claimed`,
        );
        return { success: false, message: 'No unclaimed rewards found' };
      }

      this.logger.log(
        `🎨 Minting NFT for reward ${nextUnclaimedReward.rewardId} to user ${appUserId}`,
      );

      const result = await this.rewardsService.claimRewardAdmin(
        appUserId,
        nextUnclaimedReward.rewardId,
      );

      this.logger.log(
        `✅ Badge successfully claimed: ${JSON.stringify(result)}`,
      );
      return {
        success: true,
        signature: result.signature,
        rewardId: nextUnclaimedReward.rewardId,
      };
    } catch (error) {
      if (error.message?.includes('already been claimed')) {
        this.logger.warn(
          `⚠️ Badge already claimed for user ${appUserId} - likely duplicate webhook`,
        );
        return { success: false, message: 'Badge already claimed' };
      }
      this.logger.error(
        `❌ Failed to process badge claim for user ${appUserId}:`,
        error.stack,
      );
      throw error;
    }
  }

  async handleStreakShieldPurchase(appUserId: string, _productId?: string) {
    const users = await db.select().from(user).where(eq(user.id, appUserId));
    if (users.length === 0) {
      throw new Error(`User not found: ${appUserId}`);
    }

    const currentUser = users[0];
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 7);

    await db
      .update(user)
      .set({
        streakShieldActive: true,
        streakShieldExpiry: expiry,
        streakShieldPurchases: (currentUser.streakShieldPurchases || 0) + 1,
      })
      .where(eq(user.id, appUserId));

    this.logger.log(
      `Streak Shield activated for user ${appUserId} until ${expiry}`,
    );
    return { success: true, expiresAt: expiry };
  }

  async handleQuizRefreshPurchase(appUserId: string) {
    const users = await db.select().from(user).where(eq(user.id, appUserId));
    if (users.length === 0) throw new Error('User not found');

    const currentUser = users[0];
    const newLimit = (currentUser.quizLimits || 0) + 5;

    await db
      .update(user)
      .set({ quizLimits: newLimit })
      .where(eq(user.id, appUserId));

    this.logger.log(
      `Quiz refresh: user ${appUserId} now has ${newLimit} attempts`,
    );
    return { success: true, newLimit };
  }

  async purchaseStreakShieldViaApi(userId: string) {
    await this.walletService.payMicrotransaction(userId, 0.99, 'streak_shield');
    return this.handleStreakShieldPurchase(userId);
  }

  async purchaseQuizRefreshViaApi(userId: string) {
    await this.walletService.payMicrotransaction(userId, 0.49, 'quiz_refresh');
    return this.handleQuizRefreshPurchase(userId);
  }
}
