import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import db from '../../drizzle';
import { user, userReward } from '../../lib/db/schema';
import { RewardsService } from '../rewards/rewards.service';
import { WalletService } from '../wallet/wallet.service';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @Inject(forwardRef(() => RewardsService))
    private readonly rewardsService: RewardsService,
    @Inject(forwardRef(() => WalletService))
    private readonly walletService: WalletService,
  ) {}

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
