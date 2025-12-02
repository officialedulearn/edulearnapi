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
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import db from '../../drizzle';
import { AuthService } from 'src/auth/auth.service';
import { earning, premiumTransactions, totalVolumes, user as userSchema } from 'lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import axios from 'axios';
import { transactionSenderAndConfirmationWaiter } from '../../lib/transaction/transactionSender';
import { TwitterService } from 'src/twitter/twitter.service';
import { ResendService } from 'src/resend/resend.service';
import { initializeSDK, initiate, verify, getTokenValue, createOrder, TransactionStatus, TransactionType, Currency } from 'paj_ramp';

export interface DeviceInfo {

  uuid: string;
  device: string;
  os: string;
  browser: string;
  ip: string;
}



export interface OnrampWebhookData {
  id: string;
  address: string;
  signature?: string;
  mint: string;
  currency: Currency;
  amount: number;
  usdcAmount: number;
  fiatAmount: number;
  sender: string;
  receipiant: string;
  rate: number;
  status: TransactionStatus;
  transactionType: TransactionType;
}

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
    'https://solana-mainnet.g.alchemy.com/v2/pVe3T4LaDnJDqmmlBrkp_',
  );
  private readonly heliusConnection = new Connection(
    "https://mainnet.helius-rpc.com/?api-key=36181439-ce38-4a9f-8adc-d413c0a4e218"
  );

  private readonly proPaymentWallet: PublicKey = new PublicKey("CT9ispmUxpBrbXT4kiLuJNMKoYWEZXtos2cKcSds4jY5")
  private readonly lamportsToSend = 0.0007;

  private readonly webhookEvents = new Map<string, OnrampWebhookData[]>();

  constructor(
    @Inject(forwardRef(() => AuthService))
    private authService: AuthService,
    private twitterService: TwitterService,
    private resendService: ResendService
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

    if (amount !== 5 && amount !== 50) {
      throw new Error('Invalid premium amount. Must be 5 (monthly) or 50 (annual)');
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
      
      const accountInfo = await this.connection.getAccountInfo(userUsdcTokenAccount);
      if (!accountInfo) {
        throw new Error('User does not have a USDC token account. Please ensure you have USDC in your wallet.');
      }

      const tokenAccountInfo = await this.connection.getParsedTokenAccountsByOwner(userPublicKey, {
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
      this.connection,
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
    transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    transaction.feePayer = userPublicKey;
    transaction.sign(userKeypair);

    const signature = await this.connection.sendRawTransaction(
      transaction.serialize(),
    );
    await this.connection.confirmTransaction(signature);

    await db.insert(premiumTransactions).values({
      userId: user.id,
      signature: signature,
      amount: amount,
    });
    await db.update(totalVolumes).set({
      totalRevenue: sql`${totalVolumes.totalRevenue} + ${amount}`,
    }).where(eq(totalVolumes.id, 1));

    if(user.referredBy !== null) {
      const cut = .2 * amount
      console.log(`Processing affiliate earning: ${cut} SOL for referral code ${user.referredBy}`);

      const affiliate = await this.authService.getUserByRefCode(user.referredBy)
      if (affiliate) {
        const existingEarnings = await this.getUserEarnings(affiliate.id);
        console.log(`Affiliate ${affiliate.id} existing earnings: ${existingEarnings.sol} SOL, ${existingEarnings.edln} EDLN`);
      
        await this.addEarnings(affiliate.id, {sol: cut, edln: 0});
        
        const updatedEarnings = await this.getUserEarnings(affiliate.id);
        console.log(`Affiliate ${affiliate.id} updated earnings: ${updatedEarnings.sol} SOL, ${updatedEarnings.edln} EDLN`);
      } else {
        console.error(`Affiliate not found for referral code: ${user.referredBy}`);
      }
    }

    await this.authService.updateUserPremiumStatus(userId, true);
    console.log('Premium payment transaction sent with signature:', signature);
    
    return {
      signature,
      amount,
      currency: 'USDC',
      type: amount === 5 ? 'monthly' : 'annual'
    };
  }

  async swapSolToEdln(userId: string, amount: number, usdc?: boolean) {
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
      
      const estimatedTxFee = 0.002;
      const requiredBalance = amount + estimatedTxFee;
      
      if (currentBalance.sol < requiredBalance) {
        throw new Error(
          `Insufficient SOL balance. You have ${currentBalance.sol.toFixed(4)} SOL but need at least ${requiredBalance.toFixed(4)} SOL (${amount} SOL for swap + ${estimatedTxFee} SOL for transaction fees). Please reduce the amount or add more SOL to your wallet.`
        );
      }
      
      console.log(`Balance check passed: ${currentBalance.sol.toFixed(4)} SOL available, ${requiredBalance.toFixed(4)} SOL required`);
    } catch (error) {
      if (error.message.includes('Insufficient SOL balance')) {
        throw error;
      }
      console.log('Could not check balance for first-time detection:', error.message);
      isFirstTimeBuying = false;
    }
    
    const secretKey = bs58.default.decode(decrypt(user.encryptedPrivateKey));
    const keypair = Keypair.fromSecretKey(secretKey);
    const wallet = new Wallet(keypair);

    const axiosInstance = axios.create({
      timeout: 30000,
    });
    
    const jupiterApiEndpoints = [
      'https://lite-api.jup.ag/swap/v1',
    ];
    
    try {
      console.log('Swapping SOL to EDLN for user:', userId);
      console.log('Amount:', amount * LAMPORTS_PER_SOL, 'lamports');
      
      let quoteResponse;
      let currentEndpointIndex = 0;
      
      while (!quoteResponse && currentEndpointIndex < jupiterApiEndpoints.length) {
        const baseUrl = jupiterApiEndpoints[currentEndpointIndex];
        const quoteUrl = `${baseUrl}/quote?inputMint=${usdc ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : 'So11111111111111111111111111111111111111112'}\
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
            
            dynamicComputeUnitLimit: true,
            dynamicSlippage: true,
            prioritizationFeeLamports: {
              priorityLevelWithMaxLamports: {
                maxLamports: 1000000,
                priorityLevel: "veryHigh"
              }
            }
          });
          console.log('Swap transaction received with optimization parameters');
          
          if (swapTx.data.prioritizationFeeLamports) {
            console.log('Prioritization fee lamports:', swapTx.data.prioritizationFeeLamports);
          }
          if (swapTx.data.computeUnitLimit) {
            console.log('Compute unit limit:', swapTx.data.computeUnitLimit);
          }
          if (swapTx.data.dynamicSlippageReport) {
            console.log('Dynamic slippage report:', swapTx.data.dynamicSlippageReport);
          }
          
        } catch (error) {
          console.warn(`Failed to get swap transaction from ${baseUrl}:`, error.message);
          currentEndpointIndex++;
        }
      }
      
      if (!swapTx) {
        throw new Error('Failed to get swap transaction from any Jupiter API endpoint');
      }

      const { 
        swapTransaction, 
        lastValidBlockHeight,
        prioritizationFeeLamports,
        computeUnitLimit,
        prioritizationType,
        dynamicSlippageReport,
        simulationError
      } = swapTx.data;
      
      if (simulationError) {
        console.error('Transaction simulation failed:', JSON.stringify(simulationError, null, 2));
        
        const errorMsg = simulationError.message || 'Unknown simulation error';
        
        if (errorMsg.includes('insufficient') || errorMsg.includes('Insufficient')) {
          throw new Error(
            `Insufficient balance for transaction. This usually means you don't have enough SOL to cover both the swap amount and gas fees. Try reducing the swap amount or add more SOL to your wallet.`
          );
        }
        
        if (errorMsg.includes('slippage')) {
          throw new Error(
            `Price slippage too high. The token price changed during the transaction. Please try again.`
          );
        }
        
        if (errorMsg.includes('blockhash') || errorMsg.includes('BlockhashNotFound')) {
          throw new Error(
            `Transaction expired. Please try again.`
          );
        }
        
        throw new Error(`Transaction simulation failed: ${errorMsg}. This may be due to insufficient balance for gas fees, network congestion, or price volatility. Please try again with a smaller amount.`);
      }
      
      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      if (prioritizationFeeLamports) {
        console.log(`Transaction will use prioritization fee: ${prioritizationFeeLamports} lamports`);
      }
      if (computeUnitLimit) {
        console.log(`Transaction compute unit limit: ${computeUnitLimit}`);
      }
      if (dynamicSlippageReport) {
        console.log(`Dynamic slippage applied: ${dynamicSlippageReport.slippageBps} bps`);
      }

      transaction.sign([keypair]);

      const blockhashWithExpiryBlockHeight = await this.connection.getLatestBlockhash();

      
      console.log('Sending transaction with improved transaction sender...');
      const txResponse = await transactionSenderAndConfirmationWaiter({
        connection: this.connection,
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
      
      if (error.message.includes('Insufficient SOL balance') || 
          error.message.includes('Insufficient balance for transaction') ||
          error.message.includes('insufficient')) {
        throw error;
      }
      
      if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
        throw new Error('Transaction timeout. The network may be congested. Please try again.');
      }
      
      if (error.message.includes('Failed to get quote') || error.message.includes('Failed to get swap transaction')) {
        throw new Error('Unable to connect to swap service. Please check your internet connection and try again.');
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

      const userBalance = await this.getBalance(new PublicKey(user.address as unknown as string));

      if (userBalance.tokenAccount < amount) {
        throw new Error(`Insufficient EDLN balance. You have ${userBalance.tokenAccount} EDLN but need ${amount} EDLN to burn.`);
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
      
      await db.update(totalVolumes).set({
        totalEdlnBurned: sql`${totalVolumes.totalEdlnBurned} + ${amount}`,
      }).where(eq(totalVolumes.id, 1));

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

      await db.update(userSchema).set({
        totalEarnings: `${Number(user.totalEarnings) + Number(solValue)}`
      }).where(eq(userSchema.id, userId));

      console.log(`Earnings added successfully for user ${userId}`, result);

      if (user.email && user.name) {
        try {
          const html = this.getNewEarningsEmailTemplate(
            user.name,
            Number(solValue),
            Number(edlnValue)
          );
          await this.resendService.sendEmail(
            user.email,
            '💰 New Earnings Available to Claim!',
            html
          );
          console.log(`Earnings notification email sent to ${user.email}`);
        } catch (emailError) {
          console.error('Failed to send earnings notification email:', emailError.message);
        }
      }

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
      
      // Delete earnings FIRST to prevent race condition from multiple claims
      const earnings = await db.delete(earning).where(eq(earning.userId, userId)).returning();
      
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
        // Restore earnings if nothing to claim for this type
        for (const earn of earnings) {
          await db.insert(earning).values(earn);
        }
        return { success: false, message: 'No earnings to claim for the selected type' };
      }

      const userPublicKey = new PublicKey(user.address as unknown as string);
      
      const transactions: any = [];

      try {
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
        
        if (type === 'sol' && totalEdln > 0) {
          await this.addEarnings(userId, { edln: totalEdln });
        } else if (type === 'edln' && totalSol > 0) {
          await this.addEarnings(userId, { sol: totalSol });
        }
      } catch (transferError) {
        console.error('Transfer failed, restoring earnings:', transferError.message);
        for (const earn of earnings) {
          await db.insert(earning).values(earn);
        }
        throw transferError;
      }

      const post = `
      @${user.username} claimed ${totalSol} USDC on EduLearn
      Putting their total earnings to ${Number(user.totalEarnings).toFixed(2)} USDC

      Solscan link: https://solscan.io/tx/${transactions[0].tx}
      Start learning and earning rewards on edulearn.fun
      `

      const html = this.getEarningsClaimEmailTemplate(
        user.name,
        totalSol,
        totalEdln,
        type,
        transactions
      );

      await this.resendService.sendEmail(user.email, '💰 Earnings Claimed Successfully!', html);

      await this.twitterService.postTweet(post);
      console.log('Successfully posted earnings to X');
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
      transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = adminKeypair.publicKey;
      transaction.sign(adminKeypair);

      const txid = await sendAndConfirmTransaction(this.connection, transaction, [adminKeypair]);
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
        this.connection,
        adminKeypair,
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
      transaction.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      transaction.feePayer = adminKeypair.publicKey;
      transaction.sign(adminKeypair);

      const txid = await sendAndConfirmTransaction(this.connection, transaction, [adminKeypair]);
      console.log('EDLN transfer successful with signature:', txid);
      
      return txid;
    } catch (error) {
      console.error('Error transferring EDLN:', error.message);
      throw new Error(`EDLN transfer failed: ${error.message}`);
    }
  }

  private async swapAdminUsdcToEdln(usdcAmount: number) {
    try {
      const adminSecretKey = process.env.ADMIN_WALLET_SECRET_KEY;
      if (!adminSecretKey) {
        throw new Error('Admin wallet secret key not configured');
      }
      
      const adminKeypair = Keypair.fromSecretKey(
        bs58.default.decode(adminSecretKey)
      );
      const adminWallet = new Wallet(adminKeypair);

      const axiosInstance = axios.create({
        timeout: 30000,
      });
      
      const jupiterApiEndpoints = [
        'https://lite-api.jup.ag/swap/v1',
      ];
      
      console.log(`Admin wallet swapping ${usdcAmount} USDC to EDLN (keeping in admin wallet)`);
      
      const usdcDecimals = 6;
      const amountInSmallestUnit = usdcAmount * Math.pow(10, usdcDecimals);
      
      let quoteResponse;
      let currentEndpointIndex = 0;
      
      while (!quoteResponse && currentEndpointIndex < jupiterApiEndpoints.length) {
        const baseUrl = jupiterApiEndpoints[currentEndpointIndex];
        const quoteUrl = `${baseUrl}/quote?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\
&outputMint=CFw2KxMpWuxivoowkF8vRCrnMuDeg5VMHRR7zjE7pBLV\
&amount=${amountInSmallestUnit}\
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
            userPublicKey: adminWallet.publicKey.toString(),
            dynamicComputeUnitLimit: true,
            dynamicSlippage: true,
            prioritizationFeeLamports: {
              priorityLevelWithMaxLamports: {
                maxLamports: 1000000,
                priorityLevel: "veryHigh"
              }
            }
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

      const { swapTransaction, simulationError } = swapTx.data;
      
      if (simulationError) {
        console.warn('Simulation error detected:', simulationError);
        throw new Error(`Transaction simulation failed: ${simulationError.message || 'Unknown simulation error'}`);
      }
      
      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

      transaction.sign([adminKeypair]);

      const blockhashWithExpiryBlockHeight = await this.connection.getLatestBlockhash();
      
      console.log('Sending admin USDC->EDLN swap transaction...');
      const txResponse = await transactionSenderAndConfirmationWaiter({
        connection: this.connection,
        serializedTransaction: Buffer.from(transaction.serialize()),
        blockhashWithExpiryBlockHeight,
      });

      if (!txResponse) {
        throw new Error('Transaction failed or expired');
      }

      const txid = txResponse.transaction.signatures[0];
      console.log('Admin swap confirmed with signature:', txid);
      
      return txid;
    } catch (error) {
      console.error('Error during admin USDC to EDLN swap:', error.message);
      if (error.response) {
        console.error('API error response:', error.response.data);
      }
      throw new Error(`Admin swap failed: ${error.message}`);
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
        this.connection,
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
      const blockhashWithExpiryBlockHeight = await this.connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhashWithExpiryBlockHeight.blockhash;
      transaction.feePayer = adminKeypair.publicKey;
      transaction.sign(adminKeypair);

      const txResponse = await transactionSenderAndConfirmationWaiter({
        connection: this.connection,
        serializedTransaction: transaction.serialize(),
        blockhashWithExpiryBlockHeight,
      });

      if (!txResponse) {
        throw new Error('Transaction failed or expired');
      }

      const txid = txResponse.transaction.signatures[0];
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

  async initiateOnramp(userId: string) {
    initializeSDK('production')
    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const initiated = initiate(user.email, "365d7766-608e-4287-8b6e-cd89532441b1")
    return {
      initiated: initiated,
      email: user.email,
      address: user.address,
    };
  }

  async verifyOnramp(email: string, otp: string, deviceInfo: DeviceInfo) {
    const verified = await verify(email, otp, deviceInfo, "365d7766-608e-4287-8b6e-cd89532441b1");
    if (!verified) {
      throw new Error('Failed to verify onramp');
    }
    return verified;
  }

  async onrampFiatToEdln(userId: string, amount: number, verifiedResponse: any) {

  const verifiedResponseToken = verifiedResponse.token
  const user = await this.authService.getUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const order = await createOrder({
    fiatAmount: amount,
    currency: 'NGN',    
    recipient: user.address as string,
    mint: 'CFw2KxMpWuxivoowkF8vRCrnMuDeg5VMHRR7zjE7pBLV',
    chain: 'SOLANA',
    webhookURL: 'https://api.edulearn.fun/wallet/onramp-webhook',
    token: verifiedResponseToken,
  });

  return order;
}

  processWebhookEvent(data: OnrampWebhookData): void {
    const recipientAddress = data.receipiant || data.address;
    
    if (!this.webhookEvents.has(recipientAddress)) {
      this.webhookEvents.set(recipientAddress, []);
    }
    
    const events = this.webhookEvents.get(recipientAddress)!;
    const existingIndex = events.findIndex(e => e.id === data.id);
    
    if (existingIndex >= 0) {
      events[existingIndex] = data;
    } else {
      events.push(data);
    }
    
    console.log(`Webhook event stored for address ${recipientAddress}:`, {
      id: data.id,
      status: data.status,
      amount: data.amount,
      type: data.transactionType
    });
    
    setTimeout(() => {
      const currentEvents = this.webhookEvents.get(recipientAddress);
      if (currentEvents) {
        const filtered = currentEvents.filter(e => e.id !== data.id);
        if (filtered.length === 0) {
          this.webhookEvents.delete(recipientAddress);
        } else {
          this.webhookEvents.set(recipientAddress, filtered);
        }
      }
    }, 5 * 60 * 1000);
  }

  getPendingWebhookEvents(address: string): OnrampWebhookData[] {
    return this.webhookEvents.get(address) || [];
  }

  clearWebhookEvent(address: string, eventId: string): void {
    const events = this.webhookEvents.get(address);
    if (events) {
      const filtered = events.filter(e => e.id !== eventId);
      if (filtered.length === 0) {
        this.webhookEvents.delete(address);
      } else {
        this.webhookEvents.set(address, filtered);
      }
    }
  }

  private getEarningsClaimEmailTemplate(
    name: string,
    totalSol: number,
    totalEdln: number,
    type: 'sol' | 'edln' | 'all',
    transactions: any[]
  ): string {
    const hasUsdc = (type === 'sol' || type === 'all') && totalSol > 0;
    const hasEdln = (type === 'edln' || type === 'all') && totalEdln > 0;
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Earnings Claimed</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: 'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0D0D0D; color: #CCCCCC;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0D0D0D;">
        <tr>
            <td align="center" style="padding: 40px 20px;">
                <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="background-color: #151515; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; overflow: hidden; max-width: 600px;">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background-color: #121212; padding: 40px 30px; text-align: center; border-bottom: 2px solid #00FF80;">
                            <div style="font-size: 64px; margin-bottom: 15px;">💰</div>
                            <h1 style="margin: 0; color: #FFFFFF; font-size: 32px; font-weight: 700; letter-spacing: -0.5px;">
                                Earnings Claimed!
                            </h1>
                            <p style="margin: 10px 0 0 0; color: #BFBFBF; font-size: 16px;">
                                Your rewards are on their way to your wallet
                            </p>
                        </td>
                    </tr>

                    <!-- Greeting -->
                    <tr>
                        <td style="padding: 40px 30px 20px 30px;">
                            <h2 style="margin: 0 0 15px 0; color: #FFFFFF; font-size: 24px; font-weight: 600;">
                                Congratulations, ${name}! 🎉
                            </h2>
                            <p style="margin: 0; color: #CCCCCC; font-size: 15px; line-height: 1.6;">
                                Your earnings have been successfully transferred to your wallet!
                            </p>
                        </td>
                    </tr>

                    <!-- Earnings Summary -->
                    <tr>
                        <td style="padding: 20px 30px;">
                            <div style="background-color: rgba(0, 255, 128, 0.08); border-radius: 12px; padding: 24px; border: 2px solid rgba(0, 255, 128, 0.2);">
                                <h3 style="margin: 0 0 20px 0; color: #FFFFFF; font-size: 20px; font-weight: 600; text-align: center;">
                                    📊 Claim Summary
                                </h3>
                                
                                ${hasUsdc ? `
                                <div style="background-color: #1A1A1A; border-radius: 12px; padding: 20px; margin-bottom: ${hasEdln ? '15px' : '0'}; border: 1px solid rgba(255, 255, 255, 0.08);">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <div style="font-size: 14px; color: #BFBFBF; margin-bottom: 5px;">USDC Claimed</div>
                                            <div style="font-size: 28px; font-weight: 700; color: #00FF80;">
                                                $${totalSol.toFixed(2)}
                                            </div>
                                        </div>
                                        <div style="font-size: 40px;">💵</div>
                                    </div>
                                </div>
                                ` : ''}

                                ${hasEdln ? `
                                <div style="background-color: #1A1A1A; border-radius: 12px; padding: 20px; border: 1px solid rgba(255, 255, 255, 0.08);">
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <div>
                                            <div style="font-size: 14px; color: #BFBFBF; margin-bottom: 5px;">EDLN Tokens</div>
                                            <div style="font-size: 28px; font-weight: 700; color: #00FF80;">
                                                ${totalEdln.toFixed(2)} $EDLN
                                            </div>
                                        </div>
                                        <div style="font-size: 40px;">🪙</div>
                                    </div>
                                </div>
                                ` : ''}
                            </div>
                        </td>
                    </tr>

                    <!-- Transaction Details -->
                    ${transactions.length > 0 ? `
                    <tr>
                        <td style="padding: 20px 30px;">
                            <h3 style="margin: 0 0 15px 0; color: #FFFFFF; font-size: 18px; font-weight: 600;">
                                🔗 Transaction Details
                            </h3>
                            ${transactions.map(tx => `
                                <div style="background-color: #1A1A1A; border-radius: 8px; padding: 15px; margin-bottom: 10px; border-left: 4px solid #00FF80; border: 1px solid rgba(255, 255, 255, 0.08);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <span style="font-weight: 600; color: #FFFFFF; text-transform: uppercase; font-size: 12px;">
                                            ${tx.type === 'usdc' ? 'USDC' : 'EDLN'} Transfer
                                        </span>
                                        <span style="color: #CCCCCC; font-size: 14px;">
                                            ${tx.type === 'usdc' ? `$${tx.amount.toFixed(2)}` : `${tx.amount.toFixed(2)} $EDLN`}
                                        </span>
                                    </div>
                                    <a href="https://solscan.io/tx/${tx.tx}" style="color: #00FF80; text-decoration: none; font-size: 12px; word-break: break-all;">
                                        View on Solscan →
                                    </a>
                                </div>
                            `).join('')}
                        </td>
                    </tr>
                    ` : ''}

                    <!-- What's Next -->
                    <tr>
                        <td style="padding: 20px 30px;">
                            <div style="border-left: 3px solid #00FF80; padding-left: 16px;">
                                <h4 style="margin: 0 0 8px 0; color: #FFFFFF; font-size: 16px; font-weight: 600;">
                                    💡 Keep Earning More!
                                </h4>
                                <p style="margin: 0; color: #BFBFBF; font-size: 14px; line-height: 1.6;">
                                    Continue sharing your referral code with friends to earn even more rewards. Every referral who goes premium earns you 20% commission! and also staying top on the leaderboard
                                </p>
                            </div>
                        </td>
                    </tr>

                    <!-- Motivational Quote -->
                    <tr>
                        <td style="padding: 20px 30px;">
                            <div style="text-align: center; padding: 20px; border-top: 1px solid rgba(255, 255, 255, 0.08); border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
                                <p style="margin: 0; color: #BFBFBF; font-size: 16px; line-height: 1.6; font-style: italic;">
                                    "Success is the sum of small efforts repeated day in and day out." 🌟
                                </p>
                                <p style="margin: 15px 0 0 0; color: #00FF80; font-size: 14px; font-weight: 600;">
                                    Keep learning, keep earning, EduLearner! 🫡
                                </p>
                            </div>
                        </td>
                    </tr>

                    <!-- CTA Button -->
                    <tr>
                        <td style="padding: 30px; text-align: center;">
                            <a href="https://edulearn.fun/dashboard/rewards" style="display: inline-block; background-color: #00FF80; color: #000000; text-decoration: none; padding: 16px 48px; border-radius: 10px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 16px rgba(0, 255, 128, 0.25);">
                                View My Dashboard →
                            </a>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #121212; padding: 30px; text-align: center; border-top: 1px solid rgba(255, 255, 255, 0.08);">
                            <p style="margin: 0 0 8px 0; color: #BFBFBF; font-size: 14px;">
                                Questions about your earnings?
                            </p>
                            <p style="margin: 0 0 10px 0; color: #BFBFBF; font-size: 14px;">
                                Contact us at <a href="mailto:dave@edulearn.fun" style="color: #00FF80; text-decoration: none;">dave@edulearn.fun</a>
                            </p>
                            <p style="margin: 0; color: #9E9E9E; font-size: 12px;">
                                © 2025 EduLearn. Made with ❤️ for lifelong learners.
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

  private getNewEarningsEmailTemplate(
    name: string,
    solAmount: number,
    edlnAmount: number
  ): string {
    const hasUsdc = solAmount > 0;
    const hasEdln = edlnAmount > 0;
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Earnings Available</title>
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
              <div style="font-size:64px;margin-bottom:15px;">💰</div>
              <h1 style="margin:0;color:#FFFFFF;font-size:32px;font-weight:700;letter-spacing:-0.5px;">New Earnings Available!</h1>
              <p style="margin:10px 0 0;color:#BFBFBF;font-size:16px;">You've received new rewards from your affiliate referrals</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:40px 30px 20px 30px;">
              <h2 style="margin:0 0 15px 0;color:#FFFFFF;font-size:24px;font-weight:600;">Great news, ${name}! 🎉</h2>
              <p style="margin:0;color:#CCCCCC;font-size:15px;line-height:1.6;">
                Your referral just went premium and you've earned affiliate commissions! Your earnings are now ready to claim.
              </p>
            </td>
          </tr>

          <!-- Earnings Summary -->
          <tr>
            <td style="padding:20px 30px;">
              <div style="background:linear-gradient(135deg, rgba(0,255,128,0.08) 0%, rgba(0,255,128,0.04) 100%);border-radius:12px;padding:24px;border:2px solid rgba(0,255,128,0.2);">
                <h3 style="margin:0 0 20px 0;color:#FFFFFF;font-size:20px;font-weight:600;text-align:center;">
                  💵 Your New Earnings
                </h3>
                
                ${hasUsdc ? `
                <div style="background-color:#1A1A1A;border-radius:12px;padding:20px;margin-bottom:${hasEdln ? '15px' : '0'};border:1px solid rgba(255,255,255,0.08);">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <div style="font-size:14px;color:#BFBFBF;margin-bottom:5px;">USDC Earned</div>
                      <div style="font-size:28px;font-weight:700;color:#00FF80;">
                        $${solAmount.toFixed(2)}
                      </div>
                    </div>
                    <div style="font-size:40px;">💵</div>
                  </div>
                </div>
                ` : ''}

                ${hasEdln ? `
                <div style="background-color:#1A1A1A;border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.08);">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <div style="font-size:14px;color:#BFBFBF;margin-bottom:5px;">EDLN Tokens</div>
                      <div style="font-size:28px;font-weight:700;color:#00FF80;">
                        ${edlnAmount.toFixed(2)} $EDLN
                      </div>
                    </div>
                    <div style="font-size:40px;">🪙</div>
                  </div>
                </div>
                ` : ''}
              </div>
            </td>
          </tr>

          <!-- Next Steps -->
          <tr>
            <td style="padding:20px 30px;">
              <div style="border-left:3px solid #00FF80;padding-left:16px;">
                <h4 style="margin:0 0 8px 0;color:#FFFFFF;font-size:16px;font-weight:600;">
                  💡 Ready to Claim?
                </h4>
                <p style="margin:0;color:#BFBFBF;font-size:14px;line-height:1.6;">
                  Your earnings are safely stored and ready to be claimed whenever you want. Visit your wallet to transfer these rewards directly to your crypto wallet!
                </p>
              </div>
            </td>
          </tr>

          <!-- Motivational Quote -->
          <tr>
            <td style="padding:20px 30px;">
              <div style="text-align:center;padding:20px;border-top:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.08);">
                <p style="margin:0;color:#BFBFBF;font-size:16px;line-height:1.6;font-style:italic;">
                  "The best investment you can make is in yourself and others." 🌟
                </p>
                <p style="margin:15px 0 0 0;color:#00FF80;font-size:14px;font-weight:600;">
                  Keep sharing and earning, EduLearner! 🫡
                </p>
              </div>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:30px;text-align:center;">
              <a href="https://edulearn.fun/dashboard/rewards" target="_blank" style="display:inline-block;background-color:#00FF80;color:#000000;text-decoration:none;padding:16px 48px;border-radius:10px;font-weight:700;font-size:16px;box-shadow:0 4px 16px rgba(0,255,128,0.25);">Claim My Earnings →</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#121212;padding:30px;text-align:center;border-top:1px solid rgba(255,255,255,0.08);">
              <p style="margin:0 0 8px 0;color:#BFBFBF;font-size:14px;">Questions about your earnings?</p>
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
