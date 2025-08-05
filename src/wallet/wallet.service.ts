import { Injectable } from '@nestjs/common';
import {Connection, Keypair, PublicKey} from '@solana/web3.js'
import * as bs58 from 'bs58';
import { encrypt } from '../../lib/crypto.util';
import { getOrCreateAssociatedTokenAccount } from '@solana/spl-token';

@Injectable()
export class WalletService {

    private readonly EDLN: PublicKey = new PublicKey("CFw2KxMpWuxivoowkF8vRCrnMuDeg5VMHRR7zjE7pBLV")

    async genereteWallet() {
        const keypair = Keypair.generate();
        const publicKey = keypair.publicKey.toBase58();
        const secretKey = bs58.default.encode(keypair.secretKey)
        const encryptedSecret = encrypt(secretKey);

        return {
            publicKey,
            encryptedSecret
        }
    }   
    async getBalance(publicKey: PublicKey) {
        try {
            const connection = new Connection('https://api.mainnet-beta.solana.com');
            const balance = await connection.getBalance(publicKey);
            return balance / 1e9;
        } catch (error) {
            console.error('Error fetching balance:', error);
            throw new Error('Failed to fetch balance');
        }
    }
}
