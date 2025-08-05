import { Controller, Get, Param, Response } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PublicKey } from '@solana/web3.js';

@Controller('wallet')
export class WalletController {
    constructor(private walletService: WalletService) {}

    @Get("balance/:publicKey")
    async getBalance(@Response() res, @Param('publicKey') publicKey: string) {
        try {
            const balance = await this.walletService.getBalance(new PublicKey(publicKey));
            return res.status(200).json({ balance });
        } catch (error) {
            console.error('Error fetching balance:', error);
            return res.status(500).json({ error: 'Failed to fetch balance' });      
        }
    }
}
