import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuthService } from 'src/auth/auth.service';
import { WalletService } from 'src/wallet/wallet.service';
import db from '../../drizzle';
import { desc } from 'drizzle-orm';
import {  user } from '../../lib/db/schema';

@Injectable()
export class CronTasksService {
    private readonly logger = new Logger(CronTasksService.name);
    constructor(private authService: AuthService, private walletService: WalletService) {}

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
}
