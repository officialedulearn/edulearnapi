import db from '../drizzle';
import { user } from '../lib/db/schema';
import { eq } from 'drizzle-orm';
import { Keypair } from '@solana/web3.js';
import * as bs58 from 'bs58';
import { encrypt } from '../lib/crypto.util';
import { generateReferralCode } from '../lib/constants';
import { randomUUID } from 'crypto';

async function createMarketplaceUser() {
  try {
    console.log('Checking if marketplace user already exists...');

    const existingUser = await db
      .select()
      .from(user)
      .where(eq(user.email, 'marketplace@edulearn.com'))
      .limit(1);

    if (existingUser.length > 0) {
      console.log('✅ Marketplace user already exists!');
      console.log('User ID:', existingUser[0].id);
      console.log('Email:', existingUser[0].email);
      console.log('Username:', existingUser[0].username);
      console.log('Wallet Address:', existingUser[0].address);
      return existingUser[0];
    }

    console.log('Creating new marketplace user...');

    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();
    const secretKey = bs58.default.encode(keypair.secretKey);
    const encryptedSecret = encrypt(secretKey);

    const referralCode = generateReferralCode();

    const [newUser] = await db
      .insert(user)
      .values({
        id: randomUUID(),
        name: 'Marketplace Agent',
        email: 'marketplace@edulearn.com',
        username: 'marketplace_agent',
        address: publicKey,
        encryptedPrivateKey: encryptedSecret,
        referralCode: referralCode,
        level: 'novice',
        xp: 0,
        credits: '1000000',
        streak: 1,
        isPremium: true,
        quizCompleted: 0,
        verified: true,
        imageUploadLimit: 999,
        quizLimits: 999,
      })
      .returning();

    console.log('✅ Marketplace user created successfully!');
    console.log('User ID:', newUser.id);
    console.log('Email:', newUser.email);
    console.log('Username:', newUser.username);
    console.log('Wallet Address:', newUser.address);
    console.log(
      '\n📝 Important: Add this user ID to your external applications when making API requests.',
    );
    console.log(
      '📝 They should use this userId in their requests along with the MARKETPLACE_API_KEY.',
    );

    return newUser;
  } catch (error) {
    console.error('❌ Error creating marketplace user:', error);
    throw error;
  }
}

createMarketplaceUser()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });
