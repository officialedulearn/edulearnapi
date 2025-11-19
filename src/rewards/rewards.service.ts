import { Injectable, Inject, forwardRef } from '@nestjs/common';
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

import { clusterApiUrl, Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
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
import { AuthService } from '../auth/auth.service';

@Injectable()
export class RewardsService {
  private readonly connection = new Connection(clusterApiUrl('mainnet-beta'));
  private readonly EDLN: PublicKey = new PublicKey("CFw2KxMpWuxivoowkF8vRCrnMuDeg5VMHRR7zjE7pBLV");
  private readonly reciepient = new PublicKey("CPfwdgYWhKL9Lshsdm5TKxB7sC8tHyKuLWzRTZtKCR7p");
  private readonly REQUIRED_SOL = 0.02;
  private readonly REQUIRED_EDLN = 1000;

  constructor(
    private readonly resendService: ResendService,
    private readonly twitterService: TwitterService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService
  ) {
    this.resendService = resendService;
  }


  async createReward(data: {
    type: 'certificate' | 'points';
    title: string;
    description: string;
    imageUrl?: string;
  }): Promise<Reward> {
    try {
      if (!data.type || (data.type !== 'certificate' && data.type !== 'points')) {
        throw new Error('Invalid reward type. Must be either "certificate" or "points"');
      }
      if (!data.title || data.title.trim().length === 0) {
        throw new Error('Reward title is required and cannot be empty');
      }
      if (!data.description || data.description.trim().length === 0) {
        throw new Error('Reward description is required and cannot be empty');
      }
      if (data.title.length > 200) {
        throw new Error('Reward title cannot exceed 200 characters');
      }
      if (data.description.length > 1000) {
        throw new Error('Reward description cannot exceed 1000 characters');
      }

      const [newReward] = await db.insert(reward).values(data).returning();
      if (!newReward) {
        throw new Error('Failed to create reward. Database insertion returned no result');
      }
      return newReward;
    } catch (error) {
      console.error('Failed to create reward:', error.message);
      if (error.message.includes('Invalid reward type') || 
          error.message.includes('required') || 
          error.message.includes('cannot exceed')) {
        throw error;
      }
      throw new Error(`Failed to create reward: ${error.message || 'Database error occurred'}`);
    }
  }

  async getAllRewards(): Promise<Reward[]> {
    try {
      const rewards = await db.select().from(reward);
      return rewards;
    } catch (error) {
      console.error('Failed to get all rewards:', error.message);
      throw new Error(`Failed to fetch rewards: ${error.message || 'Database connection error'}`);
    }
  }

  async getRewardById(id: string): Promise<Reward | null> {
    try {
      if (!id || id.trim().length === 0) {
        throw new Error('Reward ID is required');
      }
      const results = await db.select().from(reward).where(eq(reward.id, id));
      return results[0] || null;
    } catch (error) {
      console.error(`Failed to get reward with id ${id}:`, error.message);
      if (error.message.includes('Reward ID is required')) {
        throw error;
      }
      throw new Error(`Failed to fetch reward: ${error.message || 'Database error occurred'}`);
    }
  }

  async updateReward(
    id: string,
    data: Partial<Omit<Reward, 'id' | 'createdAt'>>,
  ): Promise<Reward | null> {
    try {
      if (!id || id.trim().length === 0) {
        throw new Error('Reward ID is required');
      }
      if (data.type && data.type !== 'certificate' && data.type !== 'points') {
        throw new Error('Invalid reward type. Must be either "certificate" or "points"');
      }
      if (data.title !== undefined && (!data.title || data.title.trim().length === 0)) {
        throw new Error('Reward title cannot be empty');
      }
      if (data.title && data.title.length > 200) {
        throw new Error('Reward title cannot exceed 200 characters');
      }
      if (data.description !== undefined && (!data.description || data.description.trim().length === 0)) {
        throw new Error('Reward description cannot be empty');
      }
      if (data.description && data.description.length > 1000) {
        throw new Error('Reward description cannot exceed 1000 characters');
      }

      const existingReward = await db.select().from(reward).where(eq(reward.id, id));
      if (!existingReward.length) {
        throw new Error(`Reward with id ${id} not found`);
      }

      const [updatedReward] = await db
        .update(reward)
        .set(data)
        .where(eq(reward.id, id))
        .returning();
      return updatedReward || null;
    } catch (error) {
      console.error(`Failed to update reward with id ${id}:`, error.message);
      if (error.message.includes('Reward ID is required') || 
          error.message.includes('Invalid reward type') || 
          error.message.includes('cannot be empty') ||
          error.message.includes('cannot exceed') ||
          error.message.includes('not found')) {
        throw error;
      }
      throw new Error(`Failed to update reward: ${error.message || 'Database error occurred'}`);
    }
  }

  async deleteReward(id: string): Promise<boolean> {
    try {
      if (!id || id.trim().length === 0) {
        throw new Error('Reward ID is required');
      }

      const existingReward = await db.select().from(reward).where(eq(reward.id, id));
      if (!existingReward.length) {
        throw new Error(`Reward with id ${id} not found`);
      }

      await db.delete(userReward).where(eq(userReward.rewardId, id));

      const result = await db
        .delete(reward)
        .where(eq(reward.id, id))
        .returning();
      return result.length > 0;
    } catch (error) {
      console.error(`Failed to delete reward with id ${id}:`, error.message);
      if (error.message.includes('Reward ID is required') || error.message.includes('not found')) {
        throw error;
      }
      throw new Error(`Failed to delete reward: ${error.message || 'Database error occurred'}`);
    }
  }

  async awardRewardToUser(
    userId: string,
    rewardId: string,
  ): Promise<UserReward> {
    try {
      if (!userId || userId.trim().length === 0) {
        throw new Error('User ID is required');
      }
      if (!rewardId || rewardId.trim().length === 0) {
        throw new Error('Reward ID is required');
      }

      const userExists = await db
        .select()
        .from(user)
        .where(eq(user.id, userId));
      if (!userExists.length) {
        throw new Error(`User with id ${userId} not found. Please verify the user ID is correct`);
      }

      const rewardExists = await db
        .select()
        .from(reward)
        .where(eq(reward.id, rewardId));
      if (!rewardExists.length) {
        throw new Error(`Reward with id ${rewardId} not found. Please verify the reward ID is correct`);
      }

      const existingAward = await db
        .select()
        .from(userReward)
        .where(
          and(eq(userReward.userId, userId), eq(userReward.rewardId, rewardId)),
        );

      if (existingAward.length) {
        throw new Error(`User ${userExists[0].email} already has the reward "${rewardExists[0].title}". Cannot award the same reward twice`);
      }

      const [newUserReward] = await db
        .insert(userReward)
        .values({
          userId,
          rewardId,
          earnedAt: new Date(),
        })
        .returning();

      if (!newUserReward) {
        throw new Error('Failed to create user-reward relationship. Database insertion returned no result');
      }

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
      console.error(`Failed to award reward to user:`, error.message);
      if (error.message.includes('User ID is required') || 
          error.message.includes('Reward ID is required') ||
          error.message.includes('not found') ||
          error.message.includes('already has') ||
          error.message.includes('Failed to create')) {
        throw error;
      }
      throw new Error(`Failed to award reward: ${error.message || 'Database error occurred'}`);
    }
  }

  async claimReward(userId: string, rewardId: string) {
    try {
      if (!userId || userId.trim().length === 0) {
        throw new Error('User ID is required');
      }
      if (!rewardId || rewardId.trim().length === 0) {
        throw new Error('Reward ID is required');
      }

      const userExists = await db
        .select()
        .from(user)
        .where(eq(user.id, userId));
      if (!userExists.length) {
        throw new Error(`User with id ${userId} not found. Please verify the user ID is correct`);
      }

      if (!userExists[0].encryptedPrivateKey) {
        throw new Error('User wallet not found. Please ensure the user has a valid wallet configured');
      }

      if (!userExists[0].address) {
        throw new Error('User wallet address not found. Please ensure the user has a valid wallet address');
      }

      const rewardExists = await db
        .select()
        .from(reward)
        .where(eq(reward.id, rewardId));
      if (!rewardExists.length) {
        throw new Error(`Reward with id ${rewardId} not found. Please verify the reward ID is correct`);
      }

      const userRewardCheck = await db
        .select()
        .from(userReward)
        .where(
          and(eq(userReward.userId, userId), eq(userReward.rewardId, rewardId)),
        );
      if (!userRewardCheck.length) {
        throw new Error(`User has not been awarded the reward "${rewardExists[0].title}". You must be awarded a reward before you can claim it`);
      }

      if (userRewardCheck[0].signature) {
        throw new Error(`Reward "${rewardExists[0].title}" has already been claimed. NFT signature: ${userRewardCheck[0].signature}`);
      }

      const adminSecretKey = process.env.ADMIN_WALLET_SECRET_KEY;
      if (!adminSecretKey) {
        throw new Error('Admin wallet secret key not configured. Please contact support');
      }

      let adminKeypair: Keypair;
      try {
        adminKeypair = Keypair.fromSecretKey(bs58.default.decode(adminSecretKey));
      } catch (keyError) {
        throw new Error('Invalid admin wallet secret key configuration. Please contact support');
      }
    
      let secretKey: string;
      let userKeypair: Keypair;
      try {
        secretKey = decrypt(userExists[0].encryptedPrivateKey);
        userKeypair = Keypair.fromSecretKey(bs58.default.decode(secretKey));
      } catch (decryptError) {
        throw new Error('Failed to decrypt user wallet. Please contact support if this issue persists');
      }

      let userPublicKey: PublicKey;
      try {
        userPublicKey = new PublicKey(userExists[0].address as string);
      } catch (pubKeyError) {
        throw new Error(`Invalid wallet address format: ${userExists[0].address}. Please contact support`);
      }

      try {
        const solBalance = await this.connection.getBalance(userPublicKey);
        const solBalanceInSol = solBalance / LAMPORTS_PER_SOL;
        
        if (solBalanceInSol < this.REQUIRED_SOL) {
          throw new Error(
            `Insufficient SOL balance. You have ${solBalanceInSol.toFixed(4)} SOL but need at least ${this.REQUIRED_SOL} SOL for gas fees. Please add more SOL to your wallet and try again.`
          );
        }

        let edlnBalance = 0;
        try {
          const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(userPublicKey, {
            mint: this.EDLN,
          });
          if (tokenAccounts.value.length > 0) {
            const amount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
            const decimals = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.decimals;
            edlnBalance = Number(amount) / Math.pow(10, decimals);
          }
        } catch (tokenError) {
          console.log('Could not check EDLN balance, assuming 0:', tokenError.message);
        }

        if (edlnBalance < this.REQUIRED_EDLN) {
          throw new Error(
            `Insufficient EDLN balance. You have ${edlnBalance.toFixed(2)} EDLN but need at least ${this.REQUIRED_EDLN} EDLN for platform fees. Please add more EDLN tokens to your wallet and try again.`
          );
        }
      } catch (balanceError) {
        if (balanceError.message.includes('Insufficient SOL balance') || balanceError.message.includes('Insufficient EDLN balance')) {
          throw balanceError;
        }
        throw new Error(`Failed to check wallet balance: ${balanceError.message || 'Network error occurred'}`);
      }

      if (!rewardExists[0].ipfs) {
        throw new Error(`Reward "${rewardExists[0].title}" does not have an IPFS URI configured. Cannot mint NFT without metadata URI`);
      }

      let umi;
      let mint;
      let result;
      try {
        umi = createUmi(this.connection).use(mplCore());
        const umiKeypair = umi.eddsa.createKeypairFromSecretKey(
          bs58.default.decode(secretKey)
        );
        
        const signer = createSignerFromKeypair(umi, umiKeypair);
        umi.use(keypairIdentity(signer));

        mint = generateSigner(umi);

        result = await create(umi, {
          asset: mint,
          name: rewardExists[0].title,
          uri: `${rewardExists[0].ipfs}`,
          owner: publicKey(userExists[0].address as string)
        }).sendAndConfirm(umi);

        console.log('NFT Mint Signature:', bs58.default.encode(result.signature));
      } catch (nftError) {
        console.error('Error minting NFT:', nftError.message);
        if (nftError.message.includes('insufficient') || nftError.message.includes('Insufficient')) {
          throw new Error(`Insufficient balance for NFT minting: ${nftError.message}. Please ensure you have enough SOL for gas fees`);
        }
        if (nftError.message.includes('network') || nftError.message.includes('timeout')) {
          throw new Error(`Network error during NFT minting: ${nftError.message}. Please try again in a few moments`);
        }
        throw new Error(`Failed to mint NFT: ${nftError.message || 'Unknown error occurred during NFT creation'}`);
      }

      let userTokenAccount;
      let recipientTokenAccount;
      let txId;
      try {
        userTokenAccount = await getOrCreateAssociatedTokenAccount(
          this.connection,
          adminKeypair, 
          this.EDLN,
          userPublicKey
        );

        recipientTokenAccount = await getAssociatedTokenAddress(
          this.EDLN,
          this.reciepient
        );

        const transferInstruction = createTransferCheckedInstruction(
          userTokenAccount.address,
          this.EDLN,
          recipientTokenAccount,
          userPublicKey,
          1_000_000_000_000, 
          9
        );

        const transaction = new Transaction().add(transferInstruction);
        transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
        transaction.feePayer = adminKeypair.publicKey; 
        
        transaction.sign(adminKeypair, userKeypair);
        
        txId = await sendAndConfirmTransaction(this.connection, transaction, [adminKeypair, userKeypair]);

        console.log('Token Transfer Transaction ID:', txId);
      } catch (transferError) {
        console.error('Error transferring tokens:', transferError.message);
        if (transferError.message.includes('insufficient') || transferError.message.includes('Insufficient')) {
          throw new Error(`Insufficient balance for token transfer: ${transferError.message}. Please ensure you have enough EDLN tokens`);
        }
        if (transferError.message.includes('network') || transferError.message.includes('timeout')) {
          throw new Error(`Network error during token transfer: ${transferError.message}. Please try again in a few moments`);
        }
        throw new Error(`Failed to transfer tokens: ${transferError.message || 'Unknown error occurred during token transfer'}`);
      }

     
      const html = this.getNFTClaimEmailTemplate(
        userExists[0].name,
        rewardExists[0].title,
        rewardExists[0].description,
        rewardExists[0].imageUrl || ''
      );

      await this.resendService.sendEmail(userExists[0].email, '🎉 Congratulations! You Earned an NFT Certificate!', html);
      
      try {
        await db.update(userReward)
          .set({
            signature: bs58.default.encode(result.signature),
            lockTransactionId: txId
          })
          .where(
            and(eq(userReward.userId, userId), eq(userReward.rewardId, rewardId)),
          );
      } catch (dbError) {
        console.error('Error updating user reward record:', dbError.message);
        throw new Error(`Failed to update reward claim status: ${dbError.message || 'Database error occurred'}`);
      }

      return bs58.default.encode(result.signature);
    } catch (error) {
      console.error(`Failed to claim reward for user:`, error.message);
      if (error.message.includes('User ID is required') ||
          error.message.includes('Reward ID is required') ||
          error.message.includes('not found') ||
          error.message.includes('already been claimed') ||
          error.message.includes('has not been awarded') ||
          error.message.includes('Insufficient') ||
          error.message.includes('Failed to decrypt') ||
          error.message.includes('Invalid wallet') ||
          error.message.includes('does not have an IPFS') ||
          error.message.includes('Failed to mint') ||
          error.message.includes('Failed to transfer') ||
          error.message.includes('Failed to update')) {
        throw error;
      }
      throw new Error(`Failed to claim reward: ${error.message || 'Unknown error occurred'}`);
    }
  }

  async getUserCertificateCount(userId: string): Promise<number> {
    try {
      if (!userId || userId.trim().length === 0) {
        throw new Error('User ID is required');
      }

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
        `Failed to get certificate count for user with id ${userId}:`,
        error.message,
      );
      if (error.message.includes('User ID is required')) {
        throw error;
      }
      throw new Error(`Failed to fetch certificate count: ${error.message || 'Database error occurred'}`);
    }
  }

  async getUserRewards(userId: string): Promise<Reward[]> {
    try {
      if (!userId || userId.trim().length === 0) {
        throw new Error('User ID is required');
      }

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
      console.error(`Failed to get rewards for user with id ${userId}:`, error.message);
      if (error.message.includes('User ID is required')) {
        throw error;
      }
      throw new Error(`Failed to fetch user rewards: ${error.message || 'Database error occurred'}`);
    }
  }

  async removeRewardFromUser(
    userId: string,
    rewardId: string,
  ): Promise<boolean> {
    try {
      if (!userId || userId.trim().length === 0) {
        throw new Error('User ID is required');
      }
      if (!rewardId || rewardId.trim().length === 0) {
        throw new Error('Reward ID is required');
      }

      const result = await db
        .delete(userReward)
        .where(
          and(eq(userReward.userId, userId), eq(userReward.rewardId, rewardId)),
        )
        .returning();

      return result.length > 0;
    } catch (error) {
      console.error(`Failed to remove reward from user:`, error.message);
      if (error.message.includes('User ID is required') || error.message.includes('Reward ID is required')) {
        throw error;
      }
      throw new Error(`Failed to remove reward from user: ${error.message || 'Database error occurred'}`);
    }
  }

  async getUsersWithReward(
    rewardId: string,
  ): Promise<
    { userId: string; name: string; email: string; earnedAt: Date }[]
  > {
    try {
      if (!rewardId || rewardId.trim().length === 0) {
        throw new Error('Reward ID is required');
      }

      const rewardExists = await db.select().from(reward).where(eq(reward.id, rewardId));
      if (!rewardExists.length) {
        throw new Error(`Reward with id ${rewardId} not found. Please verify the reward ID is correct`);
      }

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
      console.error(`Failed to get users with reward id ${rewardId}:`, error.message);
      if (error.message.includes('Reward ID is required') || error.message.includes('not found')) {
        throw error;
      }
      throw new Error(`Failed to fetch reward recipients: ${error.message || 'Database error occurred'}`);
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
