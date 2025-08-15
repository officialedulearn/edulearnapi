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
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import db from '../../drizzle';
import { AuthService } from 'src/auth/auth.service';
import { premiumTransactions, user } from 'lib/db/schema';
import { eq } from 'drizzle-orm';
import axios from 'axios';
import { transactionSenderAndConfirmationWaiter } from '../../lib/transaction/transactionSender';
import * as promiseRetry from 'promise-retry';

@Injectable()
export class WalletService {
  private readonly EDLN: PublicKey = new PublicKey(
    'CFw2KxMpWuxivoowkF8vRCrnMuDeg5VMHRR7zjE7pBLV',
  );
  private readonly solStore: PublicKey = new PublicKey(
    'BTxbf6nkRX2wUiNpBVhA5SytPvST7KvEQoBDWVfpcvtv',
  );
  private readonly connection = new Connection(
    'https://api.mainnet-beta.solana.com',
  );
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

  async payPremium(userId: string) {
    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const userBalance = await this.getBalance(
      new PublicKey(user.address as unknown as PublicKey),
    );
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
    const keypair = Keypair.fromSecretKey(secretKey);
    const wallet = new Wallet(keypair);

    // Create an axios instance with more reasonable timeouts for Jupiter API
    const axiosInstance = axios.create({
      timeout: 30000, // 30 seconds
    });
    
    // Try multiple Jupiter API endpoints if one fails
    const jupiterApiEndpoints = [
      'https://quote-api.jup.ag/v6',
      'https://jupiter-quote-api.saihubd.xyz/v6',
      'https://jupiter-quote-api.bonfida.com/v6'
    ];
    
    try {
      console.log('Swapping SOL to EDLN for user:', userId);
      console.log('Amount:', amount * LAMPORTS_PER_SOL, 'lamports');
      
      // Get quote with retry logic
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

      // EDLN token has 9 decimals, so we multiply by 10^9
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
}
