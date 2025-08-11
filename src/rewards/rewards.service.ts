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
import { create, mplCore } from '@metaplex-foundation/mpl-core'
import * as bs58 from 'bs58';

import { clusterApiUrl, Connection, Keypair } from '@solana/web3.js';
import {
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  
} from '@metaplex-foundation/umi';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { decrypt } from 'lib/crypto.util';
import { sign } from 'crypto';

@Injectable()
export class RewardsService {
  private readonly connection = new Connection(
    'https://api.mainnet-beta.solana.com',
  );

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

      const umi = createUmi(clusterApiUrl('mainnet-beta'))
        .use(mplCore())
      const encodedPrivateKey = bs58.default.decode(
        decrypt(userExists[0].encryptedPrivateKey),
      );

      const umiKeypair =
        umi.eddsa.createKeypairFromSecretKey(encodedPrivateKey);
      const signer = createSignerFromKeypair(umi, umiKeypair);
      umi.use(keypairIdentity(signer));

      const mint = generateSigner(umi);

      const result = await create(umi, {
        asset: mint,
        name: rewardExists[0].title,
        uri: `${rewardExists[0].ipfs}`,
        owner: signer.publicKey,
      }).sendAndConfirm(umi);

      console.log('NFT Mint Signature:', bs58.default.encode(result.signature));
      return result
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
}
