import { Injectable, Inject, forwardRef } from '@nestjs/common';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import * as bs58 from 'bs58';
import { decrypt, encrypt } from '../../lib/crypto.util';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import db from '../../drizzle';
import { AuthService } from 'src/auth/auth.service';
import { premiumTransactions, user } from 'lib/db/schema';
import {eq} from 'drizzle-orm';

@Injectable()
export class WalletService {
  private readonly EDLN: PublicKey = new PublicKey(
    'CFw2KxMpWuxivoowkF8vRCrnMuDeg5VMHRR7zjE7pBLV',
  );
  private readonly solStore: PublicKey = new PublicKey(
    'BTxbf6nkRX2wUiNpBVhA5SytPvST7KvEQoBDWVfpcvtv',
  );
  private readonly connection = new Connection('https://api.mainnet-beta.solana.com');
  private readonly lamportsToSend = 0.0007;


  constructor(
    @Inject(forwardRef(() => AuthService))
    private authService: AuthService,
  ) {}

  async getDecryptedPrivateKey(userId: string): Promise<string> {
      try {
        const userExists = await db
          .select()
          .from(user)
          .where(eq(user.id, userId));
        
        if (!userExists.length) {
          throw new Error(`User with id ${userId} not found`);
        }
        
        const decryptedKey = decrypt(userExists[0].encryptedPrivateKey);
        return decryptedKey;
      } catch (error) {
        console.error('Failed to get decrypted private key', error);
        throw error;
      }
    }
    
  async genereteWallet() {
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();
    const secretKey = bs58.default.encode(keypair.secretKey);
    const encryptedSecret = encrypt(secretKey);

    return {
      publicKey,
      encryptedSecret,
    };
  }
  async getBalance(publicKey: PublicKey) {
    try {
      const solBalance = await this.connection.getBalance(publicKey);
      
      let tokenBalance = 0;
      try {
        const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
          publicKey,
          { mint: this.EDLN }
        );
        if (tokenAccounts.value.length > 0) {
          const amount = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
          const decimals = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.decimals;
          tokenBalance = Number(amount) / Math.pow(10, decimals);
        } else {
          console.log('No token account found, attempting to create one');
          const user = await this.authService.getUserByAddress(publicKey.toBase58());
          
          if (user && user.encryptedPrivateKey) {
            try {
              const secretKey = bs58.default.decode(decrypt(user.encryptedPrivateKey));
              const keypair = Keypair.fromSecretKey(secretKey);
              
              const tokenAccount = await getOrCreateAssociatedTokenAccount(
                this.connection,
                keypair,
                this.EDLN,
                publicKey
              );
              
              console.log('Token account created successfully');
              tokenBalance = 0;
            } catch (createError) {
              console.error('Error creating token account:', createError);
            }
          } else {
            console.log('Could not find user private key to create token account');
          }
        }
      } catch (error) {
        console.log('Error checking token accounts:', error.message);
      }
      
      return {
        sol: solBalance / LAMPORTS_PER_SOL,
        tokenAccount: tokenBalance
      };
    } catch (error) {
      console.error('Error fetching balance:', error);
      throw new Error('Failed to fetch balance');
    }
  }

  async payPremium(userId: string) {
    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const userBalance = await this.getBalance(new PublicKey(user.address as unknown as PublicKey));
    if (userBalance.sol < this.lamportsToSend) {
      throw new Error('Insufficient balance to upgrade to premium');
    }
    
    const secretKey = bs58.default.decode(decrypt(user.encryptedPrivateKey));
    const sender = Keypair.fromSecretKey(secretKey);
    const receiver = this.solStore;

    const transferInstruction = SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: receiver,
      lamports: this.lamportsToSend * LAMPORTS_PER_SOL,
    });
    const transaction = new Transaction().add(transferInstruction);

    transaction.recentBlockhash = (
      await this.connection.getLatestBlockhash()
    ).blockhash;
    transaction.feePayer = sender.publicKey;

    transaction.sign(sender);
    const signature = await this.connection.sendRawTransaction(
      transaction.serialize(),
    );
    await this.connection.confirmTransaction(signature);

    await db.insert(premiumTransactions).values({
      userId: user.id,
      signature: signature,
    });

    await this.authService.updateUserPremiumStatus(userId, true);
    console.log('Transaction sent with signature:', signature);
  }

  async swapSolToEdln(userId: string, amount: number) {
    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    const secretKey = bs58.default.decode(decrypt(user.encryptedPrivateKey));
    const sender = Keypair.fromSecretKey(secretKey);

    const quoteString = `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112\
&outputMint=CFw2KxMpWuxivoowkF8vRCrnMuDeg5VMHRR7zjE7pBLV\
&amount=${amount * LAMPORTS_PER_SOL}\
&slippageBps=50`

    

  }
}
