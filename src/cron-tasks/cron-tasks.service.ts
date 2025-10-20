import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from 'src/auth/auth.service';
import { WalletService } from 'src/wallet/wallet.service';
import { TwitterService } from 'src/twitter/twitter.service';
import db from '../../drizzle';
import { desc, and, eq, lt } from 'drizzle-orm';
import {  user } from '../../lib/db/schema';

@Injectable()
export class CronTasksService {

  
    private readonly logger = new Logger(CronTasksService.name);
    constructor(
        @Inject(forwardRef(() => AuthService))
        private authService: AuthService,
        private walletService: WalletService,
        private twitterService: TwitterService
    ) {}

    @Cron(CronExpression.EVERY_MINUTE)
    async handleLeaderboardPost() {
      const topUsers = await db.select()
      .from(user)
      .orderBy(desc(user.xp))
      .limit(3);

      const postFormat = `EduLearn Top Users 🏆

First Place: @${topUsers[0].username} - ${topUsers[0].xp} XP
Second Place: @${topUsers[1].username} - ${topUsers[1].xp} XP
Third Place: @${topUsers[2].username} - ${topUsers[2].xp} XP

Sign up on edulearn.fun to join the leaderboard and earn rewards!`;

      try {
        await this.twitterService.postTweet(postFormat);
        this.logger.log('Successfully posted leaderboard to X');
      } catch (error) {
        this.logger.error('Failed to post to social media', error);
      }
    }

    @Cron('0 0 * * *')
    async handleCreditRenewal() {
      this.logger.log('Running daily credit renewal');
      try {
        const allUsers = await db.select().from(user);
        
        for (const user of allUsers) {
          await this.authService.renewUserCredits(user.id);
        }
        
        this.logger.log('Credit renewal completed');
      } catch (error) {
        this.logger.error('Failed to process credit renewals', error);
      }
    }
    
    @Cron('0 0 18 * *') 
    async rewardTopUsersMonthly() {
      this.logger.log('Starting monthly top user rewards job');
      
      try {
        const today = new Date();
        if (today.getDate() !== 18) {
          this.logger.log('Not the 18th day of the month, skipping rewards');
          return;
        }
        
        const topUsers = await db.select()
          .from(user)
          .orderBy(desc(user.xp))
          .limit(3);
          
        this.logger.log(`Found ${topUsers.length} top users to reward`);
        
        
        const rewards = [
          { sol: 0.05, edln: 50 },   
          { sol: 0.03, edln: 30 },   
          { sol: 0.02, edln: 20 }    
        ];
        
        for (let i = 0; i < topUsers.length; i++) {
          const currentUser = topUsers[i];
          const reward = rewards[i];
          
          this.logger.log(`Awarding position ${i+1} rewards to user ${currentUser.id}: ${JSON.stringify(reward)}`);
          
          try {
            await this.walletService.addEarnings(currentUser.id, {
              sol: reward.sol,
              edln: reward.edln
            });
            
            this.logger.log(`Successfully awarded rewards to user ${currentUser.id}`);
          } catch (error) {
            this.logger.error(`Failed to award rewards to user ${currentUser.id}`, error);
          }
        }
        
        this.logger.log('Monthly top user rewards completed');
      } catch (error) {
        this.logger.error('Failed to process monthly top user rewards', error);
      }
    }

    @Cron('0 0 * * *') 
    async handlePremiumExpiration() {
      this.logger.log('Checking for expired premium subscriptions');
      try {
        const now = new Date();
        const expiredUsers = await db.select()
          .from(user)
          .where(
            and(
              eq(user.isPremium, true),
              lt(user.premiumUntil, now)
            )
          );
        
        this.logger.log(`Found ${expiredUsers.length} users with expired premium subscriptions`);
        
        for (const expiredUser of expiredUsers) {
          try {
            await this.authService.updateUserPremiumStatus(expiredUser.id, false);
            this.logger.log(`Reset premium status for user ${expiredUser.id} (${expiredUser.email})`);
          } catch (error) {
            this.logger.error(`Failed to reset premium status for user ${expiredUser.id}`, error);
          }
        }
        
        this.logger.log(`Premium expiration check completed - processed ${expiredUsers.length} expired subscriptions`);
      } catch (error) {
        this.logger.error('Failed to process premium expirations', error);
      }
    }

    
}
