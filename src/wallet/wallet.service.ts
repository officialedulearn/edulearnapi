import { Injectable, Inject, forwardRef } from '@nestjs/common';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import * as bs58 from 'bs58';
import { decrypt, encrypt } from '../../lib/crypto.util';
import { Wallet } from '@project-serum/anchor';
import {
  createBurnCheckedInstruction,
  createMint,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import db from '../../drizzle';
import { AuthService } from 'src/auth/auth.service';
import { earning, premiumTransactions, user } from 'lib/db/schema';
import { eq } from 'drizzle-orm';
import axios from 'axios';
import { transactionSenderAndConfirmationWaiter } from '../../lib/transaction/transactionSender';

@Injectable()
export class WalletService {
  private readonly EDLN: PublicKey = new PublicKey(
    'CFw2KxMpWuxivoowkF8vRCrnMuDeg5VMHRR7zjE7pBLV',
  );
  private readonly USDC: PublicKey = new PublicKey(
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  );
  private readonly solStore: PublicKey = new PublicKey(
    'BTxbf6nkRX2wUiNpBVhA5SytPvST7KvEQoBDWVfpcvtv',
  );
  private readonly connection = new Connection(
    'https://api.mainnet-beta.solana.com',
  );
  private readonly heliusConnection = new Connection(
    "https://mainnet.helius-rpc.com/?api-key=36181439-ce38-4a9f-8adc-d413c0a4e218"
  );

  private readonly proPaymentWallet: PublicKey = new PublicKey("CT9ispmUxpBrbXT4kiLuJNMKoYWEZXtos2cKcSds4jY5")
  private readonly lamportsToSend = 0.0007;

  constructor(
    @Inject(forwardRef(() => AuthService))
    private authService: AuthService,
  ) {}

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
        const tokenAccounts =
          await this.connection.getParsedTokenAccountsByOwner(publicKey, {
            mint: this.EDLN,
          });
        if (tokenAccounts.value.length > 0) {
          const amount =
            tokenAccounts.value[0].account.data.parsed.info.tokenAmount.amount;
          const decimals =
            tokenAccounts.value[0].account.data.parsed.info.tokenAmount
              .decimals;
          tokenBalance = Number(amount) / Math.pow(10, decimals);
        } else {
          console.log('No token account found, attempting to create one');
          const user = await this.authService.getUserByAddress(
            publicKey.toBase58(),
          );

          if (user && user.encryptedPrivateKey) {
            try {
              const secretKey = bs58.default.decode(
                decrypt(user.encryptedPrivateKey),
              );
              const keypair = Keypair.fromSecretKey(secretKey);

              const tokenAccount = await getOrCreateAssociatedTokenAccount(
                this.connection,
                keypair,
                this.EDLN,
                publicKey,
              );

              console.log('Token account created successfully');
              tokenBalance = 0;
            } catch (createError) {
              console.error('Error creating token account:', createError);
            }
          } else {
            console.log(
              'Could not find user private key to create token account',
            );
          }
        }
      } catch (error) {
        console.log('Error checking token accounts:', error.message);
      }

      return {
        sol: solBalance / LAMPORTS_PER_SOL,
        tokenAccount: tokenBalance,
      };
    } catch (error) {
      console.error('Error fetching balance:', error);
      throw new Error('Failed to fetch balance');
    }
  }

  async payPremium(userId: string, amount: number) {
    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (amount !== 8 && amount !== 80) {
      throw new Error('Invalid premium amount. Must be 8 (monthly) or 80 (annual)');
    }

    const userPublicKey = new PublicKey(user.address as unknown as string);
    const secretKey = bs58.default.decode(decrypt(user.encryptedPrivateKey));
    const userKeypair = Keypair.fromSecretKey(secretKey);
    let userUsdcTokenAccount;
    try {
      userUsdcTokenAccount = await getAssociatedTokenAddress(
        this.USDC,
        userPublicKey
      );
      
      const accountInfo = await this.heliusConnection.getAccountInfo(userUsdcTokenAccount);
      if (!accountInfo) {
        throw new Error('User does not have a USDC token account. Please ensure you have USDC in your wallet.');
      }

      const tokenAccountInfo = await this.heliusConnection.getParsedTokenAccountsByOwner(userPublicKey, {
        mint: this.USDC,
      });

      if (tokenAccountInfo.value.length === 0) {
        throw new Error('No USDC token account found');
      }

      const usdcBalance = tokenAccountInfo.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      if (usdcBalance < amount) {
        throw new Error(`Insufficient USDC balance. Required: ${amount} USDC, Available: ${usdcBalance} USDC`);
      }
    } catch (error) {
      console.error('Error checking USDC balance:', error.message);
      throw new Error(`Failed to verify USDC balance: ${error.message}`);
    }


    const adminSecretKey = process.env.ADMIN_WALLET_SECRET_KEY;
    if (!adminSecretKey) {
      throw new Error('Admin wallet secret key not configured');
    }
    
    const adminKeypair = Keypair.fromSecretKey(bs58.default.decode(adminSecretKey));


    const adminUsdcTokenAccount = await getAssociatedTokenAddress(
      this.USDC,
      this.proPaymentWallet
    );

    await getOrCreateAssociatedTokenAccount(
      this.heliusConnection,
      userKeypair,
      this.USDC,
      adminKeypair.publicKey
    );

    const usdcDecimals = 6;
    const adjustedAmount = amount * Math.pow(10, usdcDecimals);

    console.log(`Processing premium payment: ${amount} USDC from user ${userId}`);

    const transferInstruction = createTransferCheckedInstruction(
      userUsdcTokenAccount,
      this.USDC,
      adminUsdcTokenAccount,
      userPublicKey,
      adjustedAmount,
      usdcDecimals
    );

    const transaction = new Transaction().add(transferInstruction);
    transaction.recentBlockhash = (await this.heliusConnection.getLatestBlockhash()).blockhash;
    transaction.feePayer = userPublicKey;
    transaction.sign(userKeypair);

    const signature = await this.heliusConnection.sendRawTransaction(
      transaction.serialize(),
    );
    await this.heliusConnection.confirmTransaction(signature);

    await db.insert(premiumTransactions).values({
      userId: user.id,
      signature: signature,
      amount: amount,
    });

    await this.authService.updateUserPremiumStatus(userId, true);
    console.log('Premium payment transaction sent with signature:', signature);
    
    return {
      signature,
      amount,
      currency: 'USDC',
      type: amount === 8 ? 'monthly' : 'annual'
    };
  }

  async swapSolToEdln(userId: string, amount: number) {
    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const userPublicKey = new PublicKey(user.address as unknown as string);
    const adminKeypair = Keypair.fromSecretKey(
      bs58.default.decode(process.env.ADMIN_WALLET_SECRET_KEY || ''),
    );
   
    let isFirstTimeBuying = false;
    try {
      const currentBalance = await this.getBalance(userPublicKey);
      if (currentBalance.tokenAccount === 0) {
        isFirstTimeBuying = true;
        console.log(`First time EDLN purchase detected for user ${userId}`);
      }
    } catch (error) {
      console.log('Could not check current EDLN balance for first-time detection:', error.message);
      isFirstTimeBuying = false;
    }
    
    const secretKey = bs58.default.decode(decrypt(user.encryptedPrivateKey));
    const keypair = Keypair.fromSecretKey(secretKey);
    const wallet = new Wallet(keypair);

    const axiosInstance = axios.create({
      timeout: 30000,
    });
    
    const jupiterApiEndpoints = [
      'https://quote-api.jup.ag/v6',
      'https://jupiter-quote-api.saihubd.xyz/v6',
      'https://jupiter-quote-api.bonfida.com/v6'
    ];
    
    try {
      console.log('Swapping SOL to EDLN for user:', userId);
      console.log('Amount:', amount * LAMPORTS_PER_SOL, 'lamports');
      
      let quoteResponse;
      let currentEndpointIndex = 0;
      
      while (!quoteResponse && currentEndpointIndex < jupiterApiEndpoints.length) {
        const baseUrl = jupiterApiEndpoints[currentEndpointIndex];
        const quoteUrl = `${baseUrl}/quote?inputMint=So11111111111111111111111111111111111111112\
&outputMint=CFw2KxMpWuxivoowkF8vRCrnMuDeg5VMHRR7zjE7pBLV\
&amount=${amount * LAMPORTS_PER_SOL}\
&slippageBps=50`;
        
        try {
          console.log(`Requesting quote from: ${quoteUrl}`);
          quoteResponse = await axiosInstance.get(quoteUrl);
          console.log('Quote received successfully');
        } catch (error) {
          console.warn(`Failed to get quote from ${baseUrl}:`, error.message);
          currentEndpointIndex++;
        }
      }
      
      if (!quoteResponse) {
        throw new Error('Failed to get quote from any Jupiter API endpoint');
      }
      
      let swapTx;
      currentEndpointIndex = 0;
      
      while (!swapTx && currentEndpointIndex < jupiterApiEndpoints.length) {
        const baseUrl = jupiterApiEndpoints[currentEndpointIndex];
        const swapUrl = `${baseUrl}/swap`;
        
        try {
          console.log(`Requesting swap transaction from: ${swapUrl}`);
          swapTx = await axiosInstance.post(swapUrl, {
            quoteResponse: quoteResponse.data,
            userPublicKey: wallet.publicKey.toString(),
            wrapAndUnwrapSol: true,
            feeAccount: 'BTxbf6nkRX2wUiNpBVhA5SytPvST7KvEQoBDWVfpcvtv',
          });
          console.log('Swap transaction received');
        } catch (error) {
          console.warn(`Failed to get swap transaction from ${baseUrl}:`, error.message);
          currentEndpointIndex++;
        }
      }
      
      if (!swapTx) {
        throw new Error('Failed to get swap transaction from any Jupiter API endpoint');
      }

      const { swapTransaction } = swapTx.data;
      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      transaction.sign([adminKeypair]);

      const blockhashWithExpiryBlockHeight = await this.heliusConnection.getLatestBlockhash();

      
      console.log('Sending transaction with improved transaction sender...');
      const txResponse = await transactionSenderAndConfirmationWaiter({
        connection: this.heliusConnection,
        serializedTransaction: Buffer.from(transaction.serialize()),
        blockhashWithExpiryBlockHeight,
      });

      if (!txResponse) {
        throw new Error('Transaction failed or expired');
      }

      const txid = txResponse.transaction.signatures[0];
      console.log('Transaction confirmed with signature:', txid);
      
      if (isFirstTimeBuying) {
        try {
          await this.authService.incrementCredits(userId, 5);
          console.log(`Awarded 5 KP to user ${userId} for first-time EDLN purchase`);
        } catch (kpError) {
          console.error('Failed to award first-time purchase KP:', kpError.message);
        }
      }
      
      return `https://solscan.io/tx/${txid}`;
    } catch (error) {
      console.error('Error during SOL to EDLN swap:', error.message);
      if (error.response) {
        console.error('API error response:', error.response.data);
      }
      throw new Error(`Swap failed: ${error.message}`);
    }
  }

  async burnEDLN(userId: string, amount: number) {
    try {
      console.log(`Burning ${amount} EDLN tokens for user ${userId}`);
      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const userPublicKey = new PublicKey(user?.address as unknown as string);
      const secretKey = bs58.default.decode(decrypt(user.encryptedPrivateKey));
      const userKeyPair = Keypair.fromSecretKey(secretKey);
      
      const tokenAccount = await getAssociatedTokenAddress(
        this.EDLN,
        userPublicKey,
      );
      const tokenDecimals = 9;
      const adjustedAmount = amount * Math.pow(10, tokenDecimals);
      console.log(`Adjusted burn amount: ${amount} EDLN = ${adjustedAmount} base units`);

      const burnInstruction = createBurnCheckedInstruction(
        tokenAccount,
        this.EDLN,
        userPublicKey,
        adjustedAmount,
        tokenDecimals,
      );
      
      const transaction = new Transaction().add(burnInstruction);
      transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = userPublicKey;
      transaction.sign(userKeyPair);
      
      const blockhashWithExpiryBlockHeight = await this.connection.getLatestBlockhash();
      const txResponse = await transactionSenderAndConfirmationWaiter({
        connection: this.connection,
        serializedTransaction: transaction.serialize(),
        blockhashWithExpiryBlockHeight,
      });
      
      if (!txResponse) {
        throw new Error('Transaction failed or expired');
      }
      
      const signature = txResponse.transaction.signatures[0];
      console.log('Burn transaction confirmed with signature:', signature);
      return signature;
    } catch (error) {
      console.error('Error during EDLN token burn:', error.message);
      throw new Error(`Burn failed: ${error.message}`);
    }
  }

  async addEarnings(userId: string, data: { sol?: number; edln?: number }) {
    try {
      console.log(`Adding earnings for user ${userId}: ${JSON.stringify(data)}`);
      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      const solValue = data.sol ? Number(data.sol).toFixed(2) : '0.00';
      const edlnValue = data.edln ? Number(data.edln).toFixed(2) : '0.00';

      const [result] = await db.insert(earning).values({
        userId: userId,
        sol: solValue,
        edln: edlnValue,
        createdAt: new Date()
      }).returning();

      console.log(`Earnings added successfully for user ${userId}`, result);
      return result;
    } catch (error) {
      console.error('Error adding earnings:', error.message);
      throw new Error(`Failed to add earnings: ${error.message}`);
    }
  }

  async getUserEarnings(userId: string) {
    try {
      console.log(`Getting earnings for user ${userId}`);
      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      
      const userEarnings = await db.select().from(earning).where(eq(earning.userId, userId));
      
      let totalSol = 0;
      let totalEdln = 0;
      
      userEarnings.forEach(earn => {
        totalSol += Number(earn.sol);
        totalEdln += Number(earn.edln);
      });
      
      return {
        sol: totalSol,
        edln: totalEdln,
        hasEarnings: totalSol > 0 || totalEdln > 0
      };
    } catch (error) {
      console.error('Error getting user earnings:', error.message);
      throw new Error(`Failed to get user earnings: ${error.message}`);
    }
  }

  async claimEarnings(userId: string, type: 'sol' | 'edln' | 'all') {
    try {
      console.log(`Claiming earnings for user ${userId}, type: ${type}`);
      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      const earnings = await db.select().from(earning).where(eq(earning.userId, userId));
      
      if (!earnings.length) {
        console.log(`No earnings found for user ${userId}`);
        return { success: false, message: 'No earnings to claim' };
      }

      let totalSol = 0;
      let totalEdln = 0;
      
      earnings.forEach(earn => {
        totalSol += Number(earn.sol);
        totalEdln += Number(earn.edln);
      });
      
      console.log(`Found earnings - SOL: ${totalSol}, EDLN: ${totalEdln}`);

      if ((type === 'sol' && totalSol <= 0) || (type === 'edln' && totalEdln <= 0) || 
          (type === 'all' && totalSol <= 0 && totalEdln <= 0)) {
        return { success: false, message: 'No earnings to claim for the selected type' };
      }

      const userPublicKey = new PublicKey(user.address as unknown as string);
      
      const transactions: any = [];

      if ((type === 'sol' || type === 'all') && totalSol > 0) {
        const usdcTransaction = await this.transferUSDC(
          userPublicKey, 
          totalSol
        );
        transactions.push({ type: 'usdc', amount: totalSol, tx: usdcTransaction });
      }

      if ((type === 'edln' || type === 'all') && totalEdln > 0) {
        const edlnTransaction = await this.transferEDLN(
          userPublicKey, 
          totalEdln
        );
        transactions.push({ type: 'edln', amount: totalEdln, tx: edlnTransaction });
      }
      
      if (type === 'all' && transactions.length > 0) {
        await db.delete(earning).where(eq(earning.userId, userId));
      } else if (type === 'sol' && totalSol > 0) {
        await db.delete(earning).where(eq(earning.userId, userId));
        if (totalEdln > 0) {
          await this.addEarnings(userId, { edln: totalEdln });
        }
      } else if (type === 'edln' && totalEdln > 0) {
        await db.delete(earning).where(eq(earning.userId, userId));
        if (totalSol > 0) {
          await this.addEarnings(userId, { sol: totalSol });
        }
      }

      console.log(`Successfully claimed earnings for user ${userId}`, transactions);
      
      return {
        success: true,
        message: 'Earnings claimed successfully',
        transactions
      };
    } catch (error) {
      console.error('Error claiming earnings:', error.message);
      throw new Error(`Failed to claim earnings: ${error.message}`);
    }
  }

  private async transferSOL(toPubkey: PublicKey, amount: number) {
    try {
      const adminSecretKey = process.env.ADMIN_WALLET_SECRET_KEY;
      if (!adminSecretKey) {
        throw new Error('Admin wallet secret key not configured');
      }
      
      const adminKeypair = Keypair.fromSecretKey(
        bs58.default.decode(adminSecretKey)
      );

      const lamports = amount * LAMPORTS_PER_SOL;
      console.log(`Transferring ${lamports} lamports (${amount} SOL) from admin to ${toPubkey.toBase58()}`);

      const transferInstruction = SystemProgram.transfer({
        fromPubkey: adminKeypair.publicKey,
        toPubkey: toPubkey,
        lamports: lamports,
      });

      const transaction = new Transaction().add(transferInstruction);
      transaction.recentBlockhash = (await this.heliusConnection.getLatestBlockhash()).blockhash;
      transaction.feePayer = adminKeypair.publicKey;
      transaction.sign(adminKeypair);

      const txid = await sendAndConfirmTransaction(this.heliusConnection, transaction, [adminKeypair]);
      console.log('SOL transfer successful with signature:', txid);
      
      return txid;
    } catch (error) {
      console.error('Error transferring SOL:', error.message);
      throw new Error(`SOL transfer failed: ${error.message}`);
    }
  }

  private async transferEDLN( toPubkey: PublicKey, amount: number) {
    try {
      const adminSecretKey = process.env.ADMIN_WALLET_SECRET_KEY;
      if (!adminSecretKey) {
        throw new Error('Admin wallet secret key not configured');
      }
      
      const adminKeypair = Keypair.fromSecretKey(
        bs58.default.decode(adminSecretKey)
      );

      const sourceTokenAccount = await getAssociatedTokenAddress(
        this.EDLN,
        adminKeypair.publicKey
      );
      
      const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.heliusConnection,
        adminKeypair, // fee payer
        this.EDLN,
        toPubkey
      );
      
      const tokenDecimals = 9;
      const adjustedAmount = amount * Math.pow(10, tokenDecimals);
      
      console.log(
        `Transferring ${adjustedAmount} EDLN tokens (${amount} EDLN) from admin to ${toPubkey.toBase58()}`
      );

      const transferInstruction = createTransferCheckedInstruction(
        sourceTokenAccount,
        this.EDLN,
        destinationTokenAccount.address,
        adminKeypair.publicKey,
        adjustedAmount,
        tokenDecimals
      );

      const transaction = new Transaction().add(transferInstruction);
      transaction.recentBlockhash = (await this.heliusConnection.getLatestBlockhash()).blockhash;
      transaction.feePayer = adminKeypair.publicKey;
      transaction.sign(adminKeypair);

      const txid = await sendAndConfirmTransaction(this.heliusConnection, transaction, [adminKeypair]);
      console.log('EDLN transfer successful with signature:', txid);
      
      return txid;
    } catch (error) {
      console.error('Error transferring EDLN:', error.message);
      throw new Error(`EDLN transfer failed: ${error.message}`);
    }
  }

  private async transferUSDC(toPubkey: PublicKey, amount: number) {
    try {
      const adminSecretKey = process.env.ADMIN_WALLET_SECRET_KEY;
      if (!adminSecretKey) {
        throw new Error('Admin wallet secret key not configured');
      }
      
      const adminKeypair = Keypair.fromSecretKey(
        bs58.default.decode(adminSecretKey)
      );

      const sourceTokenAccount = await getAssociatedTokenAddress(
        this.USDC,
        adminKeypair.publicKey
      );
      
      const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(
        this.heliusConnection,
        adminKeypair, // fee payer
        this.USDC,
        toPubkey
      );
      
      const usdcDecimals = 6; // USDC has 6 decimals
      const adjustedAmount = amount * Math.pow(10, usdcDecimals);
      
      console.log(
        `Transferring ${adjustedAmount} USDC tokens (${amount} USDC) from admin to ${toPubkey.toBase58()}`
      );

      const transferInstruction = createTransferCheckedInstruction(
        sourceTokenAccount,
        this.USDC,
        destinationTokenAccount.address,
        adminKeypair.publicKey,
        adjustedAmount,
        usdcDecimals
      );

      const transaction = new Transaction().add(transferInstruction);
      transaction.recentBlockhash = (await this.heliusConnection.getLatestBlockhash()).blockhash;
      transaction.feePayer = adminKeypair.publicKey;
      transaction.sign(adminKeypair);

      const txid = await sendAndConfirmTransaction(this.heliusConnection, transaction, [adminKeypair]);
      console.log('USDC transfer successful with signature:', txid);
      
      return txid;
    } catch (error) {
      console.error('Error transferring USDC:', error.message);
      throw new Error(`USDC transfer failed: ${error.message}`);
    }
  }

  async decryptPrivateKey(userId: string) {
    try {
      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      
      if (!user.encryptedPrivateKey) {
        throw new Error('User does not have a private key');
      }
      
      const decryptedPrivateKey = decrypt(user.encryptedPrivateKey);
      const secretKey = bs58.default.decode(decryptedPrivateKey);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      return {
        keypair,
        publicKey: keypair.publicKey,
        privateKey: decryptedPrivateKey
      };
    } catch (error) {
      console.error('Error decrypting private key:', error.message);
      throw new Error(`Failed to decrypt private key: ${error.message}`);
    }
  }
}
