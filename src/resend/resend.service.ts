import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import {user} from '../../lib/db/schema';
import { eq } from 'drizzle-orm';
import db from '../../drizzle';
import { render } from '@react-email/render';
import * as React from 'react';
import { V25AnnouncementEmail } from '../emails/templates/V25AnnouncementEmail';

@Injectable()
export class ResendService {
    private readonly mascotMoods = {
        welcome: 'proud',
        nftAward: 'celebrate',
        roadmapGenerated: 'proud',
        roadmapReminder: 'curious',
        levelUp: 'celebrate',
    };

    private readonly mascotImageUrls: Record<string, string> = {
        proud: 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/proud.png',
        sad: 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/Sad.png',
        curious: 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/Curiuos.png',
        mischievous: 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/Mischievous.png',
        celebrate: 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/Celebrate.png',
        congrats: 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/congrats.png',
    };

    constructor(private readonly resend: Resend) {
        this.resend = new Resend(process.env.RESEND_API_KEY);
    }

    private readonly audienceId = 'b9e37a5c-482b-4c5b-b1d5-990fea1f7ac5';

    async getResendContacts() {
        try {
            const { data } = await this.resend.contacts.list({
                audienceId: this.audienceId,
            });
            return data?.data || [];
        } catch (error) {
            console.error('Error fetching Resend contacts:', error);
            return [];
        }
    }

    async checkContactExists(email: string): Promise<boolean> {
        const contacts = await this.getResendContacts();
        return contacts.some(contact => contact.email.toLowerCase() === email.toLowerCase());
    }

    async addAllUsersToResendContactList() {
        const users = await db.select({
            email: user.email,
            name: user.name,
        }).from(user);
        
        const resendContacts = await this.getResendContacts();
        const resendEmails = new Set(
            resendContacts.map(contact => contact.email.toLowerCase())
        );
        
        let added = 0;
        let skipped = 0;
        let failed = 0;
        
        for (const user of users) {
            if (resendEmails.has(user.email.toLowerCase())) {
                skipped++;
                continue;
            }
            
            try {
                await this.addResendContact(user.email, user.name);
                added++;
            } catch (error) {
                console.error(`Failed to add ${user.email}:`, error);
                failed++;
            }
        }
        
        return {
            message: 'Completed adding users to resend contact list',
            success: true,
            added,
            skipped,
            failed,
            total: users.length,
        };
    }

    async getUsersNotInResendContacts() {
        const users = await db.select({
            email: user.email,
            name: user.name,
        }).from(user);
        
        const resendContacts = await this.getResendContacts();
        const resendEmails = new Set(
            resendContacts.map(contact => contact.email.toLowerCase())
        );
        
        const usersNotInResend = users.filter(
            user => !resendEmails.has(user.email.toLowerCase())
        );
        
        return {
            usersNotInResend,
            count: usersNotInResend.length,
            totalUsers: users.length,
            totalResendContacts: resendContacts.length,
        };
    }

    async sendEmail(to: string, subject: string, html: string) {
        const { data, error } = await this.resend.emails.send({
            from: 'Eddy 💚 <eddy@edulearn.fun>',
            to: to,
            subject: subject,
            html: html,
        });

        if (error) {
            throw new Error(error.message);
        }

        return data;
    }

    async sendWelcomeEmail(to: string, name: string, username: string, referralCode: string) {
        const html = this.getWelcomeEmailTemplate(name, username, referralCode);
        return this.sendEmail(to, 'Welcome to EduLearn.fun 💚', html);
    }

    async sendNFTAwardEmail(to: string, name: string, nftTitle: string, nftDescription: string, imageUrl?: string) {
        const html = this.getNFTAwardEmailTemplate(name, nftTitle, nftDescription, imageUrl);
        return this.sendEmail(to, 'You Earned an Badge Certificate!', html);
    }

    async sendRoadmapGeneratedEmail(to: string, name: string, roadmapTitle: string) {
        const html = this.getRoadmapGeneratedEmailTemplate(name, roadmapTitle);
        return this.sendEmail(to, 'Your Learning Roadmap is Ready! 🚀', html);
    }

    async sendRoadmapReminderEmail(to: string, name: string, roadmapTopic: string, roadmapTitle: string, roadmapStepTitle: string, roadmapStepDescription: string, roadmapStepTime: number) {
        const html = this.getRoadmapReminderEmailTemplate(name, roadmapTopic, roadmapTitle, roadmapStepTitle, roadmapStepDescription, roadmapStepTime);
        return this.sendEmail(to, 'Roadmap Reminder 🔔', html);
    }
    async sendLevelUpEmail(to: string, name: string, leveledUpUserName: string, newLevel: number, levelTitle: string, xpTotal: number) {
        const html = this.getFollowerLevelUpEmailTemplate(name, leveledUpUserName, newLevel, levelTitle, xpTotal);
        return this.sendEmail(to, `${leveledUpUserName} Just Leveled Up! 🎉`, html);
    }

    async sendNFTFollowingEmail(to: string, followerName: string, userName: string, nftTitle: string, nftDescription: string, imageUrl?: string) {
        const html = this.getFollowerNFTEmailTemplate(followerName, userName, nftTitle, nftDescription, imageUrl);
        return this.sendEmail(to, `${userName} Earned an NFT! 🏆`, html);
    }

    async sendV25AnnouncementEmail(to: string, name: string) {
        const html = await render(
            React.createElement(V25AnnouncementEmail, { name })
        );
        return this.sendEmail(to, '🎉 EduLearn v2.5 is Here!', html);
    }

    private readonly resendRateLimit = 2;

    private sleep(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async broadcastV25Announcement() {
        const users = await db.select({
            email: user.email,
            name: user.name,
        }).from(user);

        const validUsers = users.filter(u => u.email?.trim());
        const results: PromiseSettledResult<unknown>[] = [];

        for (let i = 0; i < validUsers.length; i += this.resendRateLimit) {
            const batch = validUsers.slice(i, i + this.resendRateLimit);
            const batchResults = await Promise.allSettled(
                batch.map(u => this.sendV25AnnouncementEmail(u.email, u.name))
            );
            results.push(...batchResults);
            if (i + this.resendRateLimit < validUsers.length) {
                await this.sleep(2000);
            }
        }

        return {
            sent: results.filter(r => r.status === 'fulfilled').length,
            failed: results.filter(r => r.status === 'rejected').length,
            total: validUsers.length,
        };
    }

    async addResendContact(email: string, name: string) {
      const contact = await this.resend.contacts.create({
        email: email,
        firstName: name,
        lastName: '',
        unsubscribed: false,
        audienceId: this.audienceId,
      });
      return contact;
    }

    private getFollowerNFTEmailTemplate(followerName: string, userName: string, nftTitle: string, nftDescription: string, imageUrl?: string): string {
        const mascotMood = this.mascotMoods.nftAward;
        const mascotUrl = this.mascotImageUrls[mascotMood];

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Someone You Follow Earned an NFT</title>
        </head>
        <body style="margin:0;padding:0;background-color:#F9FBFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D3C52;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F9FBFC;">
            <tr>
              <td align="center" style="padding:40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#FFFFFF;border-radius:16px;max-width:600px;border:1px solid #EDF3FC;">
                  
                  ${mascotUrl ? `
                  <tr>
                    <td style="padding:40px 30px 20px;text-align:center;">
                      <img src="${mascotUrl}" alt="Eddie" style="width:120px;height:auto;display:block;margin:0 auto;" />
                    </td>
                  </tr>
                  ` : ''}
    
                  <tr>
                    <td style="padding:0 30px 30px;text-align:center;">
                      <h1 style="margin:0;color:#2D3C52;font-size:28px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                        NFT Achievement Alert 🏆
                      </h1>
                    </td>
                  </tr>
    
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <p style="margin:0 0 20px;color:#2D3C52;font-size:16px;line-height:24px;">
                        Hey ${followerName},
                      </p>
                      <p style="margin:0;color:#61728C;font-size:15px;line-height:22px;">
                        ${userName} just earned a new NFT certificate!
                      </p>
                    </td>
                  </tr>
    
                  ${imageUrl ? `
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <div style="text-align:center;">
                        <img src="${imageUrl}" alt="${nftTitle}" style="max-width:100%;height:auto;border-radius:12px;border:1px solid #EDF3FC;" />
                      </div>
                    </td>
                  </tr>
                  ` : ''}
    
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <div style="background-color:#000;border-radius:16px;padding:24px;">
                        <p style="margin:0 0 8px;color:#00FF80;font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                          ${userName}
                        </p>
                        <h3 style="margin:0 0 12px;color:#E0E0E0;font-size:20px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                          ${nftTitle}
                        </h3>
                        <p style="margin:0;color:#B3B3B3;font-size:14px;line-height:20px;">
                          ${nftDescription}
                        </p>
                      </div>
                    </td>
                  </tr>
    
                  <tr>
                    <td style="padding:0 30px 40px;text-align:center;">
                      <a
                        href="https://edulearn.fun"
                        target="_blank"
                        style="display:inline-block;background-color:#000;color:#00FF80;text-decoration:none;padding:16px 32px;border-radius:50px;font-weight:700;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
                      >
                        View Profile
                      </a>
                    </td>
                  </tr>
    
                  <tr>
                    <td style="padding:30px;text-align:center;border-top:1px solid #EDF3FC;">
                      <p style="margin:0 0 8px;color:#61728C;font-size:13px;">
                        Questions? <a href="mailto:dave@edulearn.fun" style="color:#00FF80;text-decoration:none;">dave@edulearn.fun</a>
                      </p>
                      <p style="margin:0;color:#9E9E9E;font-size:12px;">
                        © 2025 EduLearn
                      </p>
                    </td>
                  </tr>
    
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
        `;
    }

    private getFollowerLevelUpEmailTemplate(followerName: string, leveledUpUserName: string, newLevel: number, levelTitle: string, xpTotal: number): string {
      const mascotMood = this.mascotMoods.levelUp;
      const mascotUrl = this.mascotImageUrls[mascotMood];
    
      return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Someone You Follow Just Leveled Up</title>
      </head>
      <body style="margin:0;padding:0;background-color:#F9FBFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D3C52;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F9FBFC;">
          <tr>
            <td align="center" style="padding:40px 20px;">
              <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#FFFFFF;border-radius:16px;max-width:600px;border:1px solid #EDF3FC;">
                
                ${mascotUrl ? `
                <tr>
                  <td style="padding:40px 30px 20px;text-align:center;">
                    <img src="${mascotUrl}" alt="Eddie" style="width:120px;height:auto;display:block;margin:0 auto;" />
                  </td>
                </tr>
                ` : ''}
    
                <tr>
                  <td style="padding:0 30px 30px;text-align:center;">
                    <h1 style="margin:0;color:#2D3C52;font-size:28px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                      Level Up Alert 🚀
                    </h1>
                  </td>
                </tr>
    
                <tr>
                  <td style="padding:0 30px 30px;">
                    <p style="margin:0 0 20px;color:#2D3C52;font-size:16px;line-height:24px;">
                      Hey ${followerName},
                    </p>
                    <p style="margin:0;color:#61728C;font-size:15px;line-height:22px;">
                      Someone you follow just hit a new milestone.
                    </p>
                  </td>
                </tr>
    
                <tr>
                  <td style="padding:0 30px 30px;">
                    <div style="background-color:#000;border-radius:16px;padding:24px;">
                      <p style="margin:0 0 8px;color:#00FF80;font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                        ${leveledUpUserName}
                      </p>
                      <h3 style="margin:0 0 12px;color:#E0E0E0;font-size:20px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                        Reached Level ${newLevel}
                      </h3>
                      <p style="margin:0 0 8px;color:#B3B3B3;font-size:14px;line-height:20px;">
                        ${levelTitle}
                      </p>
                      <p style="margin:0;color:#9E9E9E;font-size:13px;">
                        Total XP: ${xpTotal}
                      </p>
                    </div>
                  </td>
                </tr>
    
                <tr>
                  <td style="padding:0 30px 40px;text-align:center;">
                    <a
                      href="https://edulearn.fun"
                      target="_blank"
                      style="display:inline-block;background-color:#000;color:#00FF80;text-decoration:none;padding:16px 32px;border-radius:50px;font-weight:700;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
                    >
                      View Profile
                    </a>
                  </td>
                </tr>
    
                <tr>
                  <td style="padding:30px;text-align:center;border-top:1px solid #EDF3FC;">
                    <p style="margin:0 0 8px;color:#61728C;font-size:13px;">
                      Questions? <a href="mailto:dave@edulearn.fun" style="color:#00FF80;text-decoration:none;">dave@edulearn.fun</a>
                    </p>
                    <p style="margin:0;color:#9E9E9E;font-size:12px;">
                      © 2025 EduLearn
                    </p>
                  </td>
                </tr>
    
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
      `;
    }
    

    private getRoadmapReminderEmailTemplate(name: string, roadmapTopic: string, roadmapTitle: string, roadmapStepTitle: string, roadmapStepDescription: string, roadmapStepTime: number): string {
        const mascotMood = this.mascotMoods.roadmapReminder;
        const mascotUrl = this.mascotImageUrls[mascotMood];
        
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Roadmap Reminder</title>
        </head>
        <body style="margin:0;padding:0;background-color:#F9FBFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D3C52;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F9FBFC;">
            <tr>
              <td align="center" style="padding:40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#FFFFFF;border-radius:16px;max-width:600px;border:1px solid #EDF3FC;">
                  
                  ${mascotUrl ? `
                  <tr>
                    <td style="padding:40px 30px 20px;text-align:center;">
                      <img src="${mascotUrl}" alt="Eddie" style="width:120px;height:auto;display:block;margin:0 auto;" />
                    </td>
                  </tr>
                  ` : ''}
                  
                  <tr>
                    <td style="padding:0 30px 30px;text-align:center;">
                      <h1 style="margin:0;color:#2D3C52;font-size:28px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Roadmap Reminder</h1>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <p style="margin:0 0 20px;color:#2D3C52;font-size:16px;line-height:24px;">Hey ${name},</p>
                      <p style="margin:0;color:#61728C;font-size:15px;line-height:22px;">You have a roadmap step waiting to be completed.</p>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <div style="background-color:#000;border-radius:16px;padding:24px;">
                        <p style="margin:0 0 8px;color:#00FF80;font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${roadmapTopic} - ${roadmapTitle}</p>
                        <h3 style="margin:0 0 12px;color:#E0E0E0;font-size:18px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${roadmapStepTitle}</h3>
                        <p style="margin:0;color:#B3B3B3;font-size:14px;line-height:20px;">${roadmapStepDescription}</p>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 40px;text-align:center;">
                      <a href="https://edulearn.fun" target="_blank" style="display:inline-block;background-color:#000;color:#00FF80;text-decoration:none;padding:16px 32px;border-radius:50px;font-weight:700;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Continue Learning</a>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:30px;text-align:center;border-top:1px solid #EDF3FC;">
                      <p style="margin:0 0 8px;color:#61728C;font-size:13px;">Questions? <a href="mailto:dave@edulearn.fun" style="color:#00FF80;text-decoration:none;">dave@edulearn.fun</a></p>
                      <p style="margin:0;color:#9E9E9E;font-size:12px;">© 2025 EduLearn</p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
        `;
    }

    private getRoadmapGeneratedEmailTemplate(name: string, roadmapTitle: string): string {
        const mascotMood = this.mascotMoods.roadmapGenerated;
        const mascotUrl = this.mascotImageUrls[mascotMood];
        
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Your Learning Roadmap is Ready</title>
        </head>
        <body style="margin:0;padding:0;background-color:#F9FBFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D3C52;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F9FBFC;">
            <tr>
              <td align="center" style="padding:40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#FFFFFF;border-radius:16px;max-width:600px;border:1px solid #EDF3FC;">
                  
                  ${mascotUrl ? `
                  <tr>
                    <td style="padding:40px 30px 20px;text-align:center;">
                      <img src="${mascotUrl}" alt="Eddie" style="width:120px;height:auto;display:block;margin:0 auto;" />
                    </td>
                  </tr>
                  ` : ''}
                  
                  <tr>
                    <td style="padding:0 30px 30px;text-align:center;">
                      <h1 style="margin:0;color:#2D3C52;font-size:28px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Your Roadmap is Ready</h1>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <p style="margin:0 0 20px;color:#2D3C52;font-size:16px;line-height:24px;">Hey ${name},</p>
                      <p style="margin:0;color:#61728C;font-size:15px;line-height:22px;">Your personalized learning roadmap has been created.</p>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <div style="background-color:#000;border-radius:16px;padding:24px;">
                        <h3 style="margin:0;color:#00FF80;font-size:20px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${roadmapTitle}</h3>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <p style="margin:0 0 12px;color:#2D3C52;font-size:16px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Where to find it</p>
                      <ul style="margin:0;padding-left:20px;color:#61728C;font-size:14px;line-height:22px;">
                        <li style="margin-bottom:8px;"><strong style="color:#2D3C52;">Mobile:</strong> Profile → My Roadmaps</li>
                        <li><strong style="color:#2D3C52;">Web:</strong> Profile → Roadmaps tab</li>
                      </ul>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <div style="background-color:#F9FBFC;border-radius:12px;padding:20px;border:1px solid #EDF3FC;">
                        <p style="margin:0 0 8px;color:#2D3C52;font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Need more roadmaps?</p>
                        <p style="margin:0;color:#61728C;font-size:13px;line-height:18px;">Ask our AI assistant to generate roadmaps for any topic you want to learn.</p>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 40px;text-align:center;">
                      <a href="https://edulearn.fun" target="_blank" style="display:inline-block;background-color:#000;color:#00FF80;text-decoration:none;padding:16px 32px;border-radius:50px;font-weight:700;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">View Roadmap</a>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:30px;text-align:center;border-top:1px solid #EDF3FC;">
                      <p style="margin:0 0 8px;color:#61728C;font-size:13px;">Questions? <a href="mailto:dave@edulearn.fun" style="color:#00FF80;text-decoration:none;">dave@edulearn.fun</a></p>
                      <p style="margin:0;color:#9E9E9E;font-size:12px;">© 2025 EduLearn</p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
        `;
    }

    private getWelcomeEmailTemplate(name: string, username: string, referralCode: string): string {
        const mascotMood = this.mascotMoods.welcome;
        const mascotUrl = this.mascotImageUrls[mascotMood];
        
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Welcome to EduLearn</title>
        </head>
        <body style="margin:0;padding:0;background-color:#F9FBFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D3C52;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F9FBFC;">
            <tr>
              <td align="center" style="padding:40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#FFFFFF;border-radius:16px;max-width:600px;border:1px solid #EDF3FC;">
                  
                  ${mascotUrl ? `
                  <tr>
                    <td style="padding:40px 30px 20px;text-align:center;">
                      <img src="${mascotUrl}" alt="Eddie" style="width:120px;height:auto;display:block;margin:0 auto;" />
                    </td>
                  </tr>
                  ` : ''}
                  
                  <tr>
                    <td style="padding:0 30px 30px;text-align:center;">
                      <h1 style="margin:0;color:#2D3C52;font-size:28px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Welcome to EduLearn</h1>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <p style="margin:0 0 20px;color:#2D3C52;font-size:16px;line-height:24px;">Hey ${name},</p>
                      <p style="margin:0;color:#61728C;font-size:15px;line-height:22px;">
                        Your account <strong style="color:#2D3C52;">@${username}</strong> is ready. Start exploring Web3 learning.
                      </p>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <div style="background-color:#000;border-radius:16px;padding:20px;">
                        <p style="margin:0 0 12px;color:#00FF80;font-size:16px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Your Referral Code</p>
                        <p style="margin:0 0 16px;color:#E0E0E0;font-size:14px;line-height:20px;">Invite friends and you'll both earn +5 XP</p>
                        <div style="background-color:#131313;border:1px solid #2E3033;border-radius:12px;padding:16px;text-align:center;">
                          <p style="margin:0;color:#00FF80;font-size:24px;font-weight:700;letter-spacing:2px;font-family:monospace;">${referralCode}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <p style="margin:0 0 12px;color:#2D3C52;font-size:16px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Get started</p>
                      <ul style="margin:0;padding-left:20px;color:#61728C;font-size:14px;line-height:22px;">
                        <li style="margin-bottom:8px;">Complete your profile</li>
                        <li style="margin-bottom:8px;">Start a roadmap or quiz</li>
                        <li style="margin-bottom:8px;">Chat with our AI tutor</li>
                        <li>Earn XP and unlock NFTs</li>
                      </ul>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 40px;text-align:center;">
                      <a href="https://edulearn.fun" target="_blank" style="display:inline-block;background-color:#000;color:#00FF80;text-decoration:none;padding:16px 32px;border-radius:50px;font-weight:700;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Start Learning</a>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:30px;text-align:center;border-top:1px solid #EDF3FC;">
                      <p style="margin:0 0 8px;color:#61728C;font-size:13px;">Questions? <a href="mailto:dave@edulearn.fun" style="color:#00FF80;text-decoration:none;">dave@edulearn.fun</a></p>
                      <p style="margin:0;color:#9E9E9E;font-size:12px;">© 2025 EduLearn</p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
        `;
    }

    private getNFTAwardEmailTemplate(name: string, nftTitle: string, nftDescription: string, imageUrl?: string): string {
        const mascotMood = this.mascotMoods.nftAward;
        const mascotUrl = this.mascotImageUrls[mascotMood];
        
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>NFT Certificate Earned</title>
        </head>
        <body style="margin:0;padding:0;background-color:#F9FBFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#2D3C52;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#F9FBFC;">
            <tr>
              <td align="center" style="padding:40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#FFFFFF;border-radius:16px;max-width:600px;border:1px solid #EDF3FC;">
                  
                  ${mascotUrl ? `
                  <tr>
                    <td style="padding:40px 30px 20px;text-align:center;">
                      <img src="${mascotUrl}" alt="Eddie" style="width:120px;height:auto;display:block;margin:0 auto;" />
                    </td>
                  </tr>
                  ` : ''}
                  
                  <tr>
                    <td style="padding:0 30px 30px;text-align:center;">
                      <h1 style="margin:0;color:#2D3C52;font-size:28px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Congratulations!</h1>
                      <p style="margin:12px 0 0;color:#61728C;font-size:15px;">You've earned an NFT certificate</p>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <p style="margin:0 0 20px;color:#2D3C52;font-size:16px;line-height:24px;">Great work, ${name}!</p>
                      <p style="margin:0;color:#61728C;font-size:15px;line-height:22px;">You've earned a new NFT certificate for your achievement.</p>
                    </td>
                  </tr>
                  
                  ${imageUrl ? `
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <div style="text-align:center;">
                        <img src="${imageUrl}" alt="${nftTitle}" style="max-width:100%;height:auto;border-radius:12px;border:1px solid #EDF3FC;" />
                      </div>
                    </td>
                  </tr>
                  ` : ''}
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <div style="background-color:#000;border-radius:16px;padding:24px;">
                        <h3 style="margin:0 0 8px;color:#00FF80;font-size:20px;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${nftTitle}</h3>
                        <p style="margin:0;color:#E0E0E0;font-size:14px;line-height:20px;">${nftDescription}</p>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <div style="background-color:#FFF9E6;border-left:3px solid #FFD700;border-radius:8px;padding:16px;">
                        <p style="margin:0 0 12px;color:#2D3C52;font-size:14px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Minting Requirements</p>
                        <p style="margin:0 0 12px;color:#61728C;font-size:13px;line-height:18px;">To mint your NFT, ensure your wallet has:</p>
                        <ul style="margin:0;padding-left:20px;color:#61728C;font-size:13px;line-height:20px;">
                          <li style="margin-bottom:6px;"><strong style="color:#2D3C52;">$0.7 worth of SOL</strong> for transaction fees</li>
                          <li><strong style="color:#2D3C52;">1000 $EDLN tokens</strong> for platform fee</li>
                        </ul>
                      </div>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 30px;">
                      <p style="margin:0 0 12px;color:#2D3C52;font-size:16px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">How to claim</p>
                      <ol style="margin:0;padding-left:20px;color:#61728C;font-size:14px;line-height:22px;">
                        <li style="margin-bottom:8px;">Visit your Rewards dashboard</li>
                        <li style="margin-bottom:8px;">Check your wallet balance</li>
                        <li>Click "Claim NFT" to mint</li>
                      </ol>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:0 30px 40px;text-align:center;">
                      <a href="https://edulearn.fun/rewards" target="_blank" style="display:inline-block;background-color:#000;color:#00FF80;text-decoration:none;padding:16px 32px;border-radius:50px;font-weight:700;font-size:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">View & Claim NFT</a>
                    </td>
                  </tr>
                  
                  <tr>
                    <td style="padding:30px;text-align:center;border-top:1px solid #EDF3FC;">
                      <p style="margin:0 0 8px;color:#61728C;font-size:13px;">Questions? <a href="mailto:dave@edulearn.fun" style="color:#00FF80;text-decoration:none;">dave@edulearn.fun</a></p>
                      <p style="margin:0;color:#9E9E9E;font-size:12px;">© 2025 EduLearn</p>
                    </td>
                  </tr>
                  
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
        `;
    }
}
