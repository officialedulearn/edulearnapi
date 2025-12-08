import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class ResendService {
    constructor(private readonly resend: Resend) {
        this.resend = new Resend(process.env.RESEND_API_KEY);
    }

    async sendEmail(to: string, subject: string, html: string) {
        const { data, error } = await this.resend.emails.send({
            from: 'dave@edulearn.fun <dave@edulearn.fun>',
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
        return this.sendEmail(to, '🎉 You Earned an NFT Certificate!', html);
    }

    async sendRoadmapGeneratedEmail(to: string, name: string, roadmapTitle: string) {
        const html = this.getRoadmapGeneratedEmailTemplate(name, roadmapTitle);
        return this.sendEmail(to, '🚀 Your Learning Roadmap is Ready!', html);
    }

    async sendRoadmapReminderEmail(to: string, name: string, roadmapTopic: string, roadmapTitle: string, roadmapStepTitle: string, roadmapStepDescription: string, roadmapStepTime: number) {
        const html = this.getRoadmapReminderEmailTemplate(name, roadmapTopic, roadmapTitle, roadmapStepTitle, roadmapStepDescription, roadmapStepTime);
        return this.sendEmail(to, '🔔 Roadmap Reminder', html);
    }

    private getRoadmapReminderEmailTemplate(name: string, roadmapTopic: string, roadmapTitle: string, roadmapStepTitle: string, roadmapStepDescription: string, roadmapStepTime: number): string {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Roadmap Reminder</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap" rel="stylesheet">
        </head>
        <body style="margin:0;padding:0;background-color:#0D0D0D;font-family:'Urbanist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#CCCCCC;">
        
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0D0D0D;">
                <tr>
                    <td align="center" style="padding:40px 20px;">
                        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#151515;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;max-width:600px;">
        
                            <!-- Header -->
                            <tr>
                                <td style="background-color:#121212;padding:40px 30px;text-align:center;border-bottom:2px solid #00FF80;">
                                    <div style="font-size:64px;margin-bottom:15px;">🔔</div>
                                    <h1 style="margin:0;color:#FFFFFF;font-size:32px;font-weight:700;letter-spacing:-0.5px;">Roadmap Reminder</h1>
                                    <p style="margin:10px 0 0;color:#BFBFBF;font-size:16px;">You have a roadmap step that is not done. Please complete it to continue your learning journey.</p>
                                </td>
                            </tr>
        
                            <!-- Greeting -->
                            <tr>
                                <td style="padding:40px 30px 20px 30px;">
                                    <h2 style="margin:0 0 15px 0;color:#FFFFFF;font-size:24px;font-weight:600;">Hey ${name}! 🔔</h2>
                                    <p style="margin:0;color:#CCCCCC;font-size:15px;line-height:1.6;">
                                        You have a roadmap step that is not done. Please complete it to continue your learning journey.
                                    </p>
                                </td>
                            </tr>
        
                            <!-- Roadmap Card -->
                            <tr>
                                <td style="padding:20px 30px;">
                                    <div style="background:linear-gradient(135deg, rgba(0,255,128,0.08) 0%, rgba(0,255,128,0.04) 100%);border-radius:12px;padding:24px;border:2px solid rgba(0,255,128,0.2);text-align:center;">
                                <h3 style="margin:0 0 15px 0;color:#00FF80;font-size:22px;font-weight:700;">
                                    📚 ${roadmapTopic} - ${roadmapTitle}
                                </h3>
                                <p style="margin:0;color:#BFBFBF;font-size:15px;line-height:1.6;">
                                    A comprehensive learning path tailored to your goals and skill level.
                                </p>
                            </div>
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
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Your Learning Roadmap is Ready</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap" rel="stylesheet">
        </head>
        <body style="margin:0;padding:0;background-color:#0D0D0D;font-family:'Urbanist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#CCCCCC;">
        
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0D0D0D;">
            <tr>
              <td align="center" style="padding:40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#151515;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;max-width:600px;">
        
                  <!-- Header -->
                  <tr>
                    <td style="background-color:#121212;padding:40px 30px;text-align:center;border-bottom:2px solid #00FF80;">
                      <div style="font-size:64px;margin-bottom:15px;">🚀</div>
                      <h1 style="margin:0;color:#FFFFFF;font-size:32px;font-weight:700;letter-spacing:-0.5px;">Your Roadmap is Ready!</h1>
                      <p style="margin:10px 0 0;color:#BFBFBF;font-size:16px;">Your personalized learning journey has been created</p>
                    </td>
                  </tr>
        
                  <!-- Greeting -->
                  <tr>
                    <td style="padding:40px 30px 20px 30px;">
                      <h2 style="margin:0 0 15px 0;color:#FFFFFF;font-size:24px;font-weight:600;">Great news, ${name}! 🎯</h2>
                      <p style="margin:0;color:#CCCCCC;font-size:15px;line-height:1.6;">
                        Your personalized learning roadmap has been generated successfully! We've crafted a structured path to help you master your learning goals.
                      </p>
                    </td>
                  </tr>
        
                  <!-- Roadmap Card -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <div style="background:linear-gradient(135deg, rgba(0,255,128,0.08) 0%, rgba(0,255,128,0.04) 100%);border-radius:12px;padding:24px;border:2px solid rgba(0,255,128,0.2);text-align:center;">
                        <h3 style="margin:0 0 15px 0;color:#00FF80;font-size:22px;font-weight:700;">
                          📚 ${roadmapTitle}
                        </h3>
                        <p style="margin:0;color:#BFBFBF;font-size:15px;line-height:1.6;">
                          A comprehensive learning path tailored to your goals and skill level.
                        </p>
                      </div>
                    </td>
                  </tr>
        
                  <!-- Where to Find It -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <h3 style="margin:0 0 20px 0;color:#FFFFFF;font-size:20px;font-weight:600;">📍 Where to Find Your Roadmap</h3>
                      
                      <div style="margin-bottom:16px;border-left:3px solid #00FF80;padding-left:16px;">
                        <h4 style="margin:0 0 4px 0;color:#FFFFFF;font-size:16px;font-weight:600;">Mobile App</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">Navigate to your <strong style="color:#00FF80;">Profile</strong> section and tap on <strong style="color:#00FF80;">My Roadmaps</strong> to view your personalized learning path.</p>
                      </div>
        
                      <div style="border-left:3px solid #00FF80;padding-left:16px;">
                        <h4 style="margin:0 0 4px 0;color:#FFFFFF;font-size:16px;font-weight:600;">Web App</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">Go to your <strong style="color:#00FF80;">Profile</strong> page and click on the <strong style="color:#00FF80;">Roadmaps</strong> tab to access all your learning roadmaps.</p>
                      </div>
                    </td>
                  </tr>
        
                  <!-- AI Assistant Info -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <div style="background-color:rgba(0,255,128,0.08);border-radius:12px;padding:24px;border:2px dashed rgba(0,255,128,0.3);">
                        <h4 style="margin:0 0 10px 0;color:#00FF80;font-size:18px;font-weight:600;">💡 Need More Roadmaps?</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">
                          Simply ask our AI learning assistant to generate additional roadmaps for any topic you want to learn! Just say something like:
                        </p>
                        <div style="background-color:#121212;border:1px solid rgba(0,255,128,0.2);border-radius:10px;padding:16px;margin-top:12px;font-style:italic;color:#CCCCCC;font-size:14px;">
                          "Create a roadmap for mastering Solana smart contracts" or "Generate a beginner's roadmap for Python"
                        </div>
                      </div>
                    </td>
                  </tr>
        
                  <!-- What's Next -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <h3 style="margin:0 0 15px 0;color:#FFFFFF;font-size:20px;font-weight:600;">What's Next?</h3>
                      <ol style="margin:0;padding-left:20px;color:#BFBFBF;font-size:14px;line-height:1.8;">
                        <li>Review your roadmap in your profile section</li>
                        <li>Start with the first module to begin earning XP</li>
                        <li>Track your progress as you complete each milestone</li>
                        <li>Chat with our AI tutor whenever you need help</li>
                        <li>Earn NFT certificates as you complete major achievements</li>
                      </ol>
                    </td>
                  </tr>
        
                  <!-- Motivational Quote -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <div style="text-align:center;padding:20px;border-top:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.08);">
                        <p style="margin:0;color:#BFBFBF;font-size:16px;line-height:1.6;font-style:italic;">
                          "The journey of a thousand miles begins with a single step." 🌟
                        </p>
                        <p style="margin:15px 0 0 0;color:#00FF80;font-size:14px;font-weight:600;">
                          Start your learning journey today!
                        </p>
                      </div>
                    </td>
                  </tr>
        
                  <!-- CTA -->
                  <tr>
                    <td style="padding:30px;text-align:center;">
                      <a href="https://edulearn.fun" target="_blank" style="display:inline-block;background-color:#00FF80;color:#000000;text-decoration:none;padding:16px 48px;border-radius:10px;font-weight:700;font-size:16px;box-shadow:0 4px 16px rgba(0,255,128,0.25);">View My Roadmap →</a>
                    </td>
                  </tr>
        
                  <!-- Footer -->
                  <tr>
                    <td style="background-color:#121212;padding:30px;text-align:center;border-top:1px solid rgba(255,255,255,0.08);">
                      <p style="margin:0 0 8px 0;color:#BFBFBF;font-size:14px;">Questions about your roadmap?</p>
                      <p style="margin:0 0 10px 0;color:#BFBFBF;font-size:14px;">Contact us at <a href="mailto:dave@edulearn.fun" style="color:#00FF80;text-decoration:none;">dave@edulearn.fun</a></p>
                      <p style="margin:0;color:#9E9E9E;font-size:12px;">© 2025 EduLearn. Made with ❤️ for lifelong learners.</p>
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
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Welcome to EduLearn</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap" rel="stylesheet">
        </head>
        <body style="margin:0;padding:0;background-color:#0D0D0D;font-family:'Urbanist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#CCCCCC;">
        
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0D0D0D;">
            <tr>
              <td align="center" style="padding:40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#151515;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;max-width:600px;">
        
                  <!-- Header -->
                  <tr>
                    <td style="background-color:#121212;padding:40px 30px;text-align:center;border-bottom:2px solid #00FF80;">
                      <h1 style="margin:0;color:#FFFFFF;font-size:32px;font-weight:700;letter-spacing:-0.5px;">Welcome to EduLearn.fun 💚</h1>
                      <p style="margin:10px 0 0;color:#BFBFBF;font-size:16px;">Your personalized journey to mastering Web3 and unlocking real opportunities begins today.</p>
                    </td>
                  </tr>
        
                  <!-- Intro -->
                  <tr>
                    <td style="padding:40px 30px 20px 30px;">
                      <h2 style="margin:0 0 15px 0;color:#FFFFFF;font-size:24px;font-weight:600;">Hey ${name},</h2>
                      <p style="margin:0;color:#CCCCCC;font-size:15px;line-height:1.6;">
                        We’re thrilled to have you join our learning community! Your account 
                        <strong style="color:#00FF80;">@${username}</strong> is ready — dive in and start exploring the world of Web3 and AI learning.
                      </p>
                    </td>
                  </tr>
        
                  <!-- Features -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <h3 style="margin:0 0 15px 0;color:#FFFFFF;font-size:20px;font-weight:600;">What’s Inside EduLearn</h3>
        
                      <div style="margin-bottom:20px;border-left:3px solid #00FF80;padding-left:16px;">
                        <h4 style="margin:0 0 4px 0;color:#FFFFFF;font-size:16px;font-weight:600;">Earn XP & Progress</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">Complete lessons, chat with AI tutors, and grow from Novice to Expert as you earn XP.</p>
                      </div>
        
                      <div style="margin-bottom:20px;border-left:3px solid #00FF80;padding-left:16px;">
                        <h4 style="margin:0 0 4px 0;color:#FFFFFF;font-size:16px;font-weight:600;">Personalized Roadmaps</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">Follow structured paths tailored to your skills and goals — from beginner to builder.</p>
                      </div>
        
                      <div style="margin-bottom:20px;border-left:3px solid #00FF80;padding-left:16px;">
                        <h4 style="margin:0 0 4px 0;color:#FFFFFF;font-size:16px;font-weight:600;">AI Learning Assistant</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">Ask, learn, and grow with your personal AI tutor — available anytime you need help.</p>
                      </div>
        
                      <div style="margin-bottom:20px;border-left:3px solid #00FF80;padding-left:16px;">
                        <h4 style="margin:0 0 4px 0;color:#FFFFFF;font-size:16px;font-weight:600;">NFT Proof-of-Work</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">Earn NFT badges that represent your verified learning milestones — stored on-chain.</p>
                      </div>
        
                      <div style="border-left:3px solid #00FF80;padding-left:16px;">
                        <h4 style="margin:0 0 4px 0;color:#FFFFFF;font-size:16px;font-weight:600;">Daily Streaks & Leaderboards</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">Stay consistent, climb ranks, and earn bonus XP for maintaining your learning streak.</p>
                      </div>
                    </td>
                  </tr>
        
                  <!-- Referral -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <div style="background-color:rgba(0,255,128,0.08);border-radius:12px;padding:24px;border:2px dashed rgba(0,255,128,0.3);text-align:center;">
                        <h3 style="margin:0 0 10px 0;color:#FFFFFF;font-size:18px;font-weight:600;">Your Referral Code</h3>
                        <p style="margin:0 0 10px 0;color:#BFBFBF;font-size:14px;line-height:1.6;">Invite friends to join EduLearn — you’ll both earn +5 XP each!</p>
                        <div style="background-color:#121212;border:1px solid rgba(0,255,128,0.2);border-radius:10px;padding:16px;margin-top:10px;font-size:26px;font-weight:700;color:#00FF80;letter-spacing:3px;font-family:'Courier New',monospace;">${referralCode}</div>
                      </div>
                    </td>
                  </tr>
        
                  <!-- Tips -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <h3 style="margin:0 0 15px 0;color:#FFFFFF;font-size:20px;font-weight:600;">Quick Start Tips</h3>
                      <ol style="margin:0;padding-left:20px;color:#BFBFBF;font-size:14px;line-height:1.8;">
                        <li>Complete your profile to personalize your experience.</li>
                        <li>Start your first roadmap or quiz to earn XP.</li>
                        <li>Chat with our AI tutor to master topics faster.</li>
                        <li>Reach 500 XP to unlock your first NFT badge.</li>
                        <li>Join the leaderboard and compete with others.</li>
                      </ol>
                    </td>
                  </tr>
        
                  <!-- CTA -->
                  <tr>
                    <td style="padding:30px;text-align:center;">
                      <a href="https://edulearn.fun" target="_blank" style="display:inline-block;background-color:#00FF80;color:#000000;text-decoration:none;padding:16px 48px;border-radius:10px;font-weight:700;font-size:16px;box-shadow:0 4px 16px rgba(0,255,128,0.25);">Start Learning Now →</a>
                    </td>
                  </tr>
        
                  <!-- Footer -->
                  <tr>
                    <td style="background-color:#121212;padding:30px;text-align:center;border-top:1px solid rgba(255,255,255,0.08);">
                      <p style="margin:0 0 8px 0;color:#BFBFBF;font-size:14px;">Questions? We’re here to help.</p>
                      <p style="margin:0 0 10px 0;color:#BFBFBF;font-size:14px;">Contact us at <a href="mailto:dave@edulearn.fun" style="color:#00FF80;text-decoration:none;">dave@edulearn.fun</a></p>
                      <p style="margin:0;color:#9E9E9E;font-size:12px;">© 2025 EduLearn. Made with ❤️ for lifelong learners.</p>
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
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>NFT Certificate Earned</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
          <link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap" rel="stylesheet">
        </head>
        <body style="margin:0;padding:0;background-color:#0D0D0D;font-family:'Urbanist',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#CCCCCC;">
        
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#0D0D0D;">
            <tr>
              <td align="center" style="padding:40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color:#151515;border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;max-width:600px;">
        
                  <!-- Header -->
                  <tr>
                    <td style="background-color:#121212;padding:40px 30px;text-align:center;border-bottom:2px solid #00FF80;">
                      <div style="font-size:64px;margin-bottom:15px;">🎉</div>
                      <h1 style="margin:0;color:#FFFFFF;font-size:32px;font-weight:700;letter-spacing:-0.5px;">Congratulations!</h1>
                      <p style="margin:10px 0 0;color:#BFBFBF;font-size:16px;">You've earned an exclusive NFT certificate</p>
                    </td>
                  </tr>
        
                  <!-- Greeting -->
                  <tr>
                    <td style="padding:40px 30px 20px 30px;">
                      <h2 style="margin:0 0 15px 0;color:#FFFFFF;font-size:24px;font-weight:600;">Amazing work, ${name}! 🌟</h2>
                      <p style="margin:0;color:#CCCCCC;font-size:15px;line-height:1.6;">
                        Your dedication and hard work have paid off. We're excited to announce that you've earned a new NFT certificate!
                      </p>
                    </td>
                  </tr>
        
                  <!-- NFT Card -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <div style="background:linear-gradient(135deg, rgba(0,255,128,0.08) 0%, rgba(0,255,128,0.04) 100%);border-radius:12px;padding:24px;border:2px solid rgba(0,255,128,0.2);">
                        ${imageUrl ? `
                        <div style="text-align:center;margin-bottom:20px;">
                          <img src="${imageUrl}" alt="${nftTitle}" style="max-width:100%;height:auto;border-radius:12px;border:1px solid rgba(255,255,255,0.08);" />
                        </div>
                        ` : ''}
                        <div style="text-align:center;">
                          <h3 style="margin:0 0 15px 0;color:#00FF80;font-size:22px;font-weight:700;">
                            🏆 ${nftTitle}
                          </h3>
                          <p style="margin:0;color:#BFBFBF;font-size:15px;line-height:1.6;">
                            ${nftDescription}
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
        
                  <!-- Important Requirements -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <div style="background-color:rgba(255,215,0,0.08);border-left:4px solid #FFD700;border-radius:8px;padding:20px;">
                        <h4 style="margin:0 0 10px 0;color:#FFD700;font-size:16px;font-weight:600;">
                          ⚠️ Important: Minting Requirements
                        </h4>
                        <p style="margin:0 0 12px 0;color:#CCCCCC;font-size:14px;line-height:1.6;">
                          To mint your NFT certificate on the blockchain, please ensure your wallet has:
                        </p>
                        <div style="margin-bottom:12px;padding-left:16px;">
                          <div style="display:flex;align-items:start;margin-bottom:8px;">
                            <span style="color:#00FF80;margin-right:8px;font-weight:700;">•</span>
                            <span style="color:#CCCCCC;font-size:14px;line-height:1.6;"><strong style="color:#FFFFFF;">$0.7 worth of SOL</strong> — Required for transaction fees on the Solana blockchain</span>
                          </div>
                          <div style="display:flex;align-items:start;">
                            <span style="color:#00FF80;margin-right:8px;font-weight:700;">•</span>
                            <span style="color:#CCCCCC;font-size:14px;line-height:1.6;"><strong style="color:#FFFFFF;">1000 $EDLN tokens</strong> — Platform fee to mint your certificate</span>
                          </div>
                        </div>
                        <p style="margin:0;color:#BFBFBF;font-size:13px;font-style:italic;">
                          💡 Tip: Keep these funds in your wallet to claim your NFT anytime!
                        </p>
                      </div>
                    </td>
                  </tr>
        
                  <!-- Next Steps -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <h3 style="margin:0 0 20px 0;color:#FFFFFF;font-size:20px;font-weight:600;">📋 How to Claim Your NFT</h3>
                      
                      <div style="margin-bottom:16px;border-left:3px solid #00FF80;padding-left:16px;">
                        <h4 style="margin:0 0 4px 0;color:#FFFFFF;font-size:16px;font-weight:600;">1. Visit Your Rewards Dashboard</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">Head to the Rewards section in your EduLearn dashboard to see your earned NFT.</p>
                      </div>
        
                      <div style="margin-bottom:16px;border-left:3px solid #00FF80;padding-left:16px;">
                        <h4 style="margin:0 0 4px 0;color:#FFFFFF;font-size:16px;font-weight:600;">2. Check Your Wallet Balance</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">Ensure you have at least $0.7 in SOL and 1000 $EDLN tokens in your wallet.</p>
                      </div>
        
                      <div style="border-left:3px solid #00FF80;padding-left:16px;">
                        <h4 style="margin:0 0 4px 0;color:#FFFFFF;font-size:16px;font-weight:600;">3. Mint Your Certificate</h4>
                        <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">Click "Claim NFT" to permanently mint your certificate on the Solana blockchain.</p>
                      </div>
                    </td>
                  </tr>
        
                  <!-- Why NFTs Matter -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <div style="background:linear-gradient(135deg, rgba(0,255,128,0.04) 0%, rgba(0,255,128,0.08) 100%);border-radius:12px;padding:20px;text-align:center;">
                        <h4 style="margin:0 0 10px 0;color:#00FF80;font-size:18px;font-weight:600;">🔐 Your Achievement, On-Chain Forever</h4>
                        <p style="margin:0;color:#CCCCCC;font-size:14px;line-height:1.6;">
                          This NFT is permanent proof of your learning achievement. It's stored on the Solana blockchain, verifiable by anyone, and can never be taken away.
                        </p>
                      </div>
                    </td>
                  </tr>
        
                  <!-- Motivational Quote -->
                  <tr>
                    <td style="padding:20px 30px;">
                      <div style="text-align:center;padding:20px;border-top:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.08);">
                        <p style="margin:0;color:#BFBFBF;font-size:16px;line-height:1.6;font-style:italic;">
                          "Excellence is not a destination; it's a continuous journey that never ends." 🚀
                        </p>
                        <p style="margin:15px 0 0 0;color:#00FF80;font-size:14px;font-weight:600;">
                          Keep learning, keep growing!
                        </p>
                      </div>
                    </td>
                  </tr>
        
                  <!-- CTA -->
                  <tr>
                    <td style="padding:30px;text-align:center;">
                      <a href="https://edulearn.fun/rewards" target="_blank" style="display:inline-block;background-color:#00FF80;color:#000000;text-decoration:none;padding:16px 48px;border-radius:10px;font-weight:700;font-size:16px;box-shadow:0 4px 16px rgba(0,255,128,0.25);">View & Claim My NFT →</a>
                    </td>
                  </tr>
        
                  <!-- Footer -->
                  <tr>
                    <td style="background-color:#121212;padding:30px;text-align:center;border-top:1px solid rgba(255,255,255,0.08);">
                      <p style="margin:0 0 8px 0;color:#BFBFBF;font-size:14px;">Questions about claiming your NFT?</p>
                      <p style="margin:0 0 10px 0;color:#BFBFBF;font-size:14px;">Contact us at <a href="mailto:dave@edulearn.fun" style="color:#00FF80;text-decoration:none;">dave@edulearn.fun</a></p>
                      <p style="margin:0;color:#9E9E9E;font-size:12px;">© 2025 EduLearn. Made with ❤️ for lifelong learners.</p>
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
