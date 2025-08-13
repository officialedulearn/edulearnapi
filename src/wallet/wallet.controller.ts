import { Body, Controller, Get, Param, Post, Response } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PublicKey } from '@solana/web3.js';

@Controller('wallet')
export class WalletController {
    constructor(private walletService: WalletService) {}

    @Post("upgrade/:userId")
    async upgradeToPremium(@Response() res, @Param('userId') userId: string) {
        try {
            const result = await this.walletService.payPremium(userId);
            return res.status(200).json({ message: 'Upgrade successful', result });
        } catch (error) {
            console.error('Error upgrading to premium:', error);
            return res.status(500).json({ error: 'Failed to upgrade to premium' });
        }
    }

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

    @Post("swap")
    async swapSolToEDLN(@Response() res, @Body() data: {userId: string, amount: number}) {
        try {
            const response = await this.walletService.swapSolToEdln(data.userId, data.amount)
            return res.status(200).json({response})
        } catch(error) {
            console.error("Error swapping sol to edln", error)
            return res.status(500).json({error: "Failed to swap SOL to EDLN"})
        }
    }
    
    @Post("burn")
    async burnEDLN(@Response() res, @Body() data: {userId: string, amount: number}) {
        try {
            const signature = await this.walletService.burnEDLN(data.userId, data.amount);
            return res.status(200).json({
                message: 'EDLN tokens burned successfully',
                signature,
                transactionLink: `https://solscan.io/tx/${signature}`
            });
        } catch(error) {
            console.error("Error burning EDLN tokens", error);
            return res.status(500).json({error: "Failed to burn EDLN tokens"});
        }
    }
}
