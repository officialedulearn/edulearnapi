import { Body, Controller, Get, Param, Post, Response, UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PublicKey } from '@solana/web3.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
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

    @Get("earnings/:userId")
    async getUserEarnings(@Response() res, @Param('userId') userId: string) {
        try {
            const earnings = await this.walletService.getUserEarnings(userId);
            return res.status(200).json({ earnings });
        } catch (error) {
            console.error('Error fetching user earnings:', error);
            return res.status(500).json({ error: 'Failed to fetch user earnings' });
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

    @Post("earnings/add")
    async addEarnings(@Response() res, @Body() data: {userId: string, sol?: number, edln?: number}) {
        try {
            const result = await this.walletService.addEarnings(data.userId, {
                sol: data.sol,
                edln: data.edln
            });
            return res.status(200).json({
                message: 'Earnings added successfully',
                result
            });
        } catch(error) {
            console.error("Error adding earnings", error);
            return res.status(500).json({error: "Failed to add earnings"});
        }
    }

    @Post("earnings/claim")
    async claimEarnings(@Response() res, @Body() data: {userId: string, type: 'sol' | 'edln' | 'all'}) {
        try {
            const result = await this.walletService.claimEarnings(data.userId, data.type);
            return res.status(200).json(result);
        } catch(error) {
            console.error("Error claiming earnings", error);
            return res.status(500).json({error: "Failed to claim earnings"});
        }
    }

    @Post("decrypt-private-key")
    async decryptPrivateKey(@Response() res, @Body() data: {userId: string}) {
        try {
            const result = await this.walletService.decryptPrivateKey(data.userId);
            return res.status(200).json({
                publicKey: result.publicKey.toString(),
                privateKey: result.privateKey,
                success: true
            });
        } catch(error) {
            console.error("Error decrypting private key", error);
            return res.status(500).json({error: "Failed to decrypt private key", success: false});
        }
    }
}
