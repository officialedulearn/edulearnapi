import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuthService } from 'src/auth/auth.service';
import { WalletService } from 'src/wallet/wallet.service';
import { TwitterService } from 'src/twitter/twitter.service';
import db from '../../drizzle';
import { desc, and, eq, lt } from 'drizzle-orm';
import {  roadmap, roadMapStep, user } from '../../lib/db/schema';
import { ExpoPushService } from 'src/common/services/expo-push.service';
import { NotificationsService } from 'src/common/services/notifications.service';
import { ResendService } from 'src/resend/resend.service';
@Injectable()
export class CronTasksService { 
  
    private readonly logger = new Logger(CronTasksService.name);
    constructor(
        @Inject(forwardRef(() => AuthService))
        private authService: AuthService,
        private walletService: WalletService,
        private twitterService: TwitterService,
        private expoPushService: ExpoPushService,
        private notificationsService: NotificationsService,
        private resendService: ResendService
    ) {
    }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async handleLeaderboardPost() {
      const topUsers = await db.select()
      .from(user)
      .orderBy(desc(user.xp))
      .limit(3);

      for (const user of topUsers) {
        if(user.expoPushToken) {
          await this.expoPushService.sendPushNotification(user.expoPushToken as string, "EduLearn Top Users 🏆", "You are in the top 3 users today, let's keep it up!", {
            screen: "leaderboard"
          });
        }
      }

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

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
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
    
    @Cron('0 0 1 * *') 
    async rewardTopUsersMonthly() {
      this.logger.log('Starting monthly top user rewards job');
      
      try {
        const today = new Date();
        if (today.getDate() !== 1) {
          this.logger.log('Not the 1st day of the month, skipping rewards');
          return;
        }
        
        const topUsers = await db.select()
          .from(user)
          .orderBy(desc(user.xp))
          .limit(10);
          
        this.logger.log(`Found ${topUsers.length} top users to reward`);
        
        for (let i = 0; i < topUsers.length; i++) {
          const currentUser = topUsers[i];
          
          const earning = 5
          try {
            await this.walletService.addEarnings(currentUser.id, {
              sol: earning,
              edln: 0
            });

            if(currentUser.expoPushToken) {
              await this.expoPushService.sendPushNotification(currentUser.expoPushToken as string, "Monthly Top User Rewards", "You have been awarded rewards for being in the top 3 users this month. Check the rewards tab on the web app to see your rewards.");
            }
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

    @Cron(CronExpression.EVERY_WEEKEND) 
    async remindUsersAboutRoadmaps() {
      const roadmapSteps = await db.select().from(roadMapStep).where(eq(roadMapStep.done, false))

      for (const roadmapStep of roadmapSteps) {
        const roadmapData = await db.select().from(roadmap).where(eq(roadmap.id, roadmapStep.roadmapId))
        const userData = await db.select().from(user).where(eq(user.id, roadmapData[0].userId))
        if(userData && userData.length > 0) {
          const funMessages = [
            `🦉 Don't make me come find you! "${roadmapStep.title}" is waiting. Only ${roadmapStep.time} minutes to level up! 🚀`,
            `🔥 Your learning streak is crying! Complete "${roadmapStep.title}" and keep that momentum going! ⚡`,
            `😢 We miss you! "${roadmapStep.title}" has been lonely. Come back and smash it in ${roadmapStep.time} minutes! 💪`,
            `⏰ Tick tock! Your roadmap "${roadmapData[0].title}" needs some love. Let's crush "${roadmapStep.title}" together! 🎯`,
            `🌟 Legend status awaits! Complete "${roadmapStep.title}" and show everyone what you're made of! 💎`
          ]
          
          const randomMessage = funMessages[Math.floor(Math.random() * funMessages.length)]
          
          await this.notificationsService.createNotification({
            title: "Hey, you forgot something! 👀",
            content: randomMessage,
            userId: userData[0].id
          })
          await this.resendService.sendRoadmapReminderEmail(userData[0].email, userData[0].name, roadmapData[0].topic, roadmapData[0].title, roadmapStep.title, roadmapStep.description, roadmapStep.time)
        }
      }
    }

  }
