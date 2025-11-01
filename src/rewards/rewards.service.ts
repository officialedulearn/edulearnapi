import { Injectable } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import db from '../../drizzle';
import {
  reward,
  userReward,
  user,
  type Reward,
  type UserReward,
} from '../../lib/db/schema';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { create, mplCore } from '@metaplex-foundation/mpl-core';
import * as bs58 from 'bs58';

import { clusterApiUrl, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  publicKey,
} from '@metaplex-foundation/umi';
import { decrypt } from 'lib/crypto.util';
import { createTransferCheckedInstruction, getAssociatedTokenAddress, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { ResendService } from '../resend/resend.service';
import { TwitterService } from '../twitter/twitter.service';

@Injectable()
export class RewardsService {
  private readonly connection = new Connection(clusterApiUrl('mainnet-beta'));
  constructor(private readonly resendService: ResendService, private readonly twitterService: TwitterService) {
    this.resendService = resendService;
  }
  private readonly tokenMint = new PublicKey("CFw2KxMpWuxivoowkF8vRCrnMuDeg5VMHRR7zjE7pBLV")
  private readonly reciepient = new PublicKey("CPfwdgYWhKL9Lshsdm5TKxB7sC8tHyKuLWzRTZtKCR7p")


  async createReward(data: {
    type: 'certificate' | 'points';
    title: string;
    description: string;
    imageUrl?: string;
  }): Promise<Reward> {
    try {
      const [newReward] = await db.insert(reward).values(data).returning();
      return newReward;
    } catch (error) {
      console.error('Failed to create reward', error);
      throw error;
    }
  }

  async getAllRewards(): Promise<Reward[]> {
    try {
      return await db.select().from(reward);
    } catch (error) {
      console.error('Failed to get all rewards', error);
      throw error;
    }
  }

  async getRewardById(id: string): Promise<Reward | null> {
    try {
      const results = await db.select().from(reward).where(eq(reward.id, id));
      return results[0] || null;
    } catch (error) {
      console.error(`Failed to get reward with id ${id}`, error);
      throw error;
    }
  }

  async updateReward(
    id: string,
    data: Partial<Omit<Reward, 'id' | 'createdAt'>>,
  ): Promise<Reward | null> {
    try {
      const [updatedReward] = await db
        .update(reward)
        .set(data)
        .where(eq(reward.id, id))
        .returning();
      return updatedReward || null;
    } catch (error) {
      console.error(`Failed to update reward with id ${id}`, error);
      throw error;
    }
  }

  async deleteReward(id: string): Promise<boolean> {
    try {
      await db.delete(userReward).where(eq(userReward.rewardId, id));

      const result = await db
        .delete(reward)
        .where(eq(reward.id, id))
        .returning();
      return result.length > 0;
    } catch (error) {
      console.error(`Failed to delete reward with id ${id}`, error);
      throw error;
    }
  }

  async awardRewardToUser(
    userId: string,
    rewardId: string,
  ): Promise<UserReward> {
    try {
      const userExists = await db
        .select()
        .from(user)
        .where(eq(user.id, userId));
      if (!userExists.length) {
        throw new Error(`User with id ${userId} not found`);
      }

      const rewardExists = await db
        .select()
        .from(reward)
        .where(eq(reward.id, rewardId));
      if (!rewardExists.length) {
        throw new Error(`Reward with id ${rewardId} not found`);
      }

      const existingAward = await db
        .select()
        .from(userReward)
        .where(
          and(eq(userReward.userId, userId), eq(userReward.rewardId, rewardId)),
        );

      if (existingAward.length) {
        throw new Error(`User already has this reward`);
      }

      const [newUserReward] = await db
        .insert(userReward)
        .values({
          userId,
          rewardId,
          earnedAt: new Date(),
        })
        .returning();

        const postText = `Congratulations to @${userExists[0].username} for earning the ${rewardExists[0].title} NFT certificate!

        You can claim the NFT in the rewards tab of web and mobile app`;
        
              try {
                if (rewardExists[0].imageUrl) {
                  const mediaId = await this.twitterService.uploadMedia(rewardExists[0].imageUrl);
                  await this.twitterService.postTweet(postText, {
                    media: {
                      media_ids: [mediaId]
                    }
                  });
                } else {
                  await this.twitterService.postTweet(postText);
                }
                console.log('Successfully posted to X');
              } catch (twitterError) {
                console.error('Failed to post to Twitter:', twitterError);
              }
        
        
      await this.resendService.sendNFTAwardEmail(
        userExists[0].email,
        userExists[0].name,
        rewardExists[0].title,
        rewardExists[0].description,
        rewardExists[0].imageUrl || undefined
      );

      return newUserReward;
    } catch (error) {
      console.error(`Failed to award reward to user`, error);
      throw error;
    }
  }

  async claimReward(userId: string, rewardId: string) {
    try {
      const userExists = await db
        .select()
        .from(user)
        .where(eq(user.id, userId));
      if (!userExists.length) {
        throw new Error(`User with id ${userId} not found`);
      }

      const rewardExists = await db
        .select()
        .from(reward)
        .where(eq(reward.id, rewardId));
      if (!rewardExists.length) {
        throw new Error(`Reward with id ${rewardId} not found`);
      }
      const adminSecretKey = process.env.ADMIN_WALLET_SECRET_KEY;
      if (!adminSecretKey) {
        throw new Error('Admin wallet secret key not configured');
      }
      const adminKeypair = Keypair.fromSecretKey(bs58.default.decode(adminSecretKey));
    
      const secretKey = decrypt(userExists[0].encryptedPrivateKey);
      const userKeypair = Keypair.fromSecretKey(
        bs58.default.decode(secretKey),
      );
      const userPublicKey = new PublicKey(userExists[0].address as string);

      const userTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        adminKeypair, 
        this.tokenMint,
        userPublicKey
      );

      const recipientTokenAccount = await getAssociatedTokenAddress(
        this.tokenMint,
        this.reciepient
      );

      const transferInstruction = createTransferCheckedInstruction(
        userTokenAccount.address,
        this.tokenMint,
        recipientTokenAccount,
        userPublicKey,
        1_000_000_000_000, 
        9
      );

      const transaction = new Transaction().add(transferInstruction);
      transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = adminKeypair.publicKey; 
      
      transaction.sign(adminKeypair, userKeypair);
      
      const txId = await sendAndConfirmTransaction(this.connection, transaction, [adminKeypair, userKeypair]);

      console.log('Transfer Transaction ID:', txId);

      const umi = createUmi(this.connection).use(mplCore());
      const umiKeypair = umi.eddsa.createKeypairFromSecretKey(
        bs58.default.decode(secretKey)
      );
      
      const signer = createSignerFromKeypair(umi, umiKeypair);
      umi.use(keypairIdentity(signer));

      const mint = generateSigner(umi);

      const result = await create(umi, {
        asset: mint,
        name: rewardExists[0].title,
        uri: `${rewardExists[0].ipfs}`,
        owner: publicKey(userExists[0].address as string)
      }).sendAndConfirm(umi);

     
      const html = this.getNFTClaimEmailTemplate(
        userExists[0].name,
        rewardExists[0].title,
        rewardExists[0].description,
        rewardExists[0].imageUrl || ''
      );

      await this.resendService.sendEmail(userExists[0].email, '🎉 Congratulations! You Earned an NFT Certificate!', html);

      console.log('NFT Mint Signature:', bs58.default.encode(result.signature));
      
      await db.update(userReward)
        .set({
          signature: bs58.default.encode(result.signature),
          lockTransactionId: txId
        })
        .where(
          and(eq(userReward.userId, userId), eq(userReward.rewardId, rewardId)),
        );

      return bs58.default.encode(result.signature);
    } catch (error) {
      console.error(`Failed to claim reward for user`, error);
      throw error;
    }
  }

  async getUserCertificateCount(userId: string): Promise<number> {
    try {
      const result = await db
        .select({ count: sql`count(*)` })
        .from(userReward)
        .innerJoin(reward, eq(userReward.rewardId, reward.id))
        .where(
          and(eq(userReward.userId, userId), eq(reward.type, 'certificate')),
        );

      return Number(result[0].count) || 0;
    } catch (error) {
      console.error(
        `Failed to get certificate count for user with id ${userId}`,
        error,
      );
      throw error;
    }
  }

  async getUserRewards(userId: string): Promise<Reward[]> {
    try {
      const results = await db
        .select({
          id: reward.id,
          type: reward.type,
          title: reward.title,
          description: reward.description,
          imageUrl: reward.imageUrl,
          createdAt: reward.createdAt,
          earnedAt: userReward.earnedAt,
          ipfs: reward.ipfs,
          signature: userReward.signature
        })
        .from(userReward)
        .innerJoin(reward, eq(userReward.rewardId, reward.id))
        .where(eq(userReward.userId, userId));

      return results;
    } catch (error) {
      console.error(`Failed to get rewards for user with id ${userId}`, error);
      throw error;
    }
  }

  async removeRewardFromUser(
    userId: string,
    rewardId: string,
  ): Promise<boolean> {
    try {
      const result = await db
        .delete(userReward)
        .where(
          and(eq(userReward.userId, userId), eq(userReward.rewardId, rewardId)),
        )
        .returning();

      return result.length > 0;
    } catch (error) {
      console.error(`Failed to remove reward from user`, error);
      throw error;
    }
  }

  async getUsersWithReward(
    rewardId: string,
  ): Promise<
    { userId: string; name: string; email: string; earnedAt: Date }[]
  > {
    try {
      const results = await db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          earnedAt: userReward.earnedAt,
          signature: userReward.signature,
        })
        .from(userReward)
        .innerJoin(user, eq(userReward.userId, user.id))
        .where(eq(userReward.rewardId, rewardId));

      return results;
    } catch (error) {
      console.error(`Failed to get users with reward id ${rewardId}`, error);
      throw error;
    }
  }

  private getNFTClaimEmailTemplate(name: string, title: string, description: string, imageUrl: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NFT Certificate Earned</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f5f5f5;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; max-width: 600px;">
                    
                    <!-- Header with animated gradient -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); padding: 40px 30px; text-align: center;">
                            <div style="font-size: 64px; margin-bottom: 15px;">🎉</div>
                            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: bold; letter-spacing: -0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                                Congratulations!
                            </h1>
                            <p style="margin: 10px 0 0 0; color: #ffffff; font-size: 16px; opacity: 0.95;">
                                You've earned an exclusive NFT certificate!
                            </p>
                        </td>
                    </tr>

                    <!-- Personalized greeting -->
                    <tr>
                        <td style="padding: 40px 30px 20px 30px; text-align: center;">
                            <h2 style="margin: 0 0 10px 0; color: #1a202c; font-size: 24px; font-weight: 600;">
                                Amazing work, ${name}! 🌟
                            </h2>
                            <p style="margin: 0; color: #4a5568; font-size: 16px; line-height: 1.6;">
                                Your dedication and hard work have paid off!
                            </p>
                        </td>
                    </tr>

                    <!-- NFT Card -->
                    <tr>
                        <td style="padding: 20px 30px;">
                            <div style="background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%); border-radius: 16px; padding: 25px; border: 2px solid #e2e8f0;">
                                ${imageUrl ? `
                                <div style="text-align: center; margin-bottom: 20px;">
                                    <img src="${imageUrl}" alt="${title}" style="max-width: 100%; height: auto; border-radius: 12px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
                                </div>
                                ` : ''}
                                <div style="text-align: center;">
                                    <h3 style="margin: 0 0 15px 0; color: #1a202c; font-size: 22px; font-weight: 700;">
                                        🏆 ${title}
                                    </h3>
                                    <p style="margin: 0; color: #4a5568; font-size: 15px; line-height: 1.6;">
                                        ${description}
                                    </p>
                                </div>
                            </div>
                        </td>
                    </tr>

                    <!-- Important Information -->
                    <tr>
                        <td style="padding: 20px 30px;">
                            <div style="background-color: #fff5f5; border-left: 4px solid #fc8181; border-radius: 8px; padding: 20px;">
                                <h4 style="margin: 0 0 10px 0; color: #c53030; font-size: 16px; font-weight: 600; display: flex; align-items: center;">
                                    ⚠️ Important Requirements
                                </h4>
                                <p style="margin: 0; color: #742a2a; font-size: 14px; line-height: 1.6;">
                                    To claim your NFT on the blockchain, please ensure you have:
                                </p>
                                <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #742a2a; font-size: 14px; line-height: 1.8;">
                                    <li><strong>$0.7 in SOL</strong> for gas fees</li>
                                    <li><strong>1000 $EDLN</strong> for platform fees</li>
                                </ul>
                            </div>
                        </td>
                    </tr>

                    <!-- What's Next Section -->
                    <tr>
                        <td style="padding: 20px 30px;">
                            <h3 style="margin: 0 0 20px 0; color: #1a202c; font-size: 20px; font-weight: 600;">
                                📋 Next Steps
                            </h3>
                            
                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 12px;">
                                <tr>
                                    <td style="width: 40px; vertical-align: top; padding-top: 3px;">
                                        <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: bold; font-size: 14px;">
                                            1
                                        </div>
                                    </td>
                                    <td style="vertical-align: top; padding-top: 3px;">
                                        <p style="margin: 0; color: #4a5568; font-size: 14px; line-height: 1.6;">
                                            Visit the <strong>Rewards</strong> section in your EduLearn dashboard
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 12px;">
                                <tr>
                                    <td style="width: 40px; vertical-align: top; padding-top: 3px;">
                                        <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: bold; font-size: 14px;">
                                            2
                                        </div>
                                    </td>
                                    <td style="vertical-align: top; padding-top: 3px;">
                                        <p style="margin: 0; color: #4a5568; font-size: 14px; line-height: 1.6;">
                                            Ensure your wallet has the required SOL and EDLN tokens
                                        </p>
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                    <td style="width: 40px; vertical-align: top; padding-top: 3px;">
                                        <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #ffffff; font-weight: bold; font-size: 14px;">
                                            3
                                        </div>
                                    </td>
                                    <td style="vertical-align: top; padding-top: 3px;">
                                        <p style="margin: 0; color: #4a5568; font-size: 14px; line-height: 1.6;">
                                            Click <strong>Claim NFT</strong> to mint your certificate to the blockchain
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Motivational Message -->
                    <tr>
                        <td style="padding: 20px 30px;">
                            <div style="background: linear-gradient(135deg, #43e97b15 0%, #38f9d715 100%); border-radius: 12px; padding: 20px; text-align: center;">
                                <p style="margin: 0; color: #1a202c; font-size: 16px; line-height: 1.6; font-weight: 500;">
                                    "Excellence is not a destination; it's a continuous journey that never ends." 🚀
                                </p>
                                <p style="margin: 15px 0 0 0; color: #4a5568; font-size: 14px;">
                                    Keep up the amazing learning journey!
                                </p>
                            </div>
                        </td>
                    </tr>

                    <!-- CTA Button -->
                    <tr>
                        <td style="padding: 20px 30px 40px 30px; text-align: center;">
                            <a href="https://edulearn.fun" style="display: inline-block; background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 8px rgba(250, 112, 154, 0.3);">
                                View My NFT Certificate →
                            </a>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f7fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                            <p style="margin: 0 0 10px 0; color: #718096; font-size: 14px;">
                                Questions about claiming your NFT?
                            </p>
                            <p style="margin: 0 0 15px 0; color: #718096; font-size: 14px;">
                                Contact us at <a href="mailto:dave@edulearn.fun" style="color: #667eea; text-decoration: none;">dave@edulearn.fun</a>
                            </p>
                            <p style="margin: 0; color: #a0aec0; font-size: 12px;">
                                © 2025 EduLearn. Empowering learners worldwide.
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
}
