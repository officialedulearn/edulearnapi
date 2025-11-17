import { Body, Controller, Get, Param, Post, Response, UseGuards, Request } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PublicKey } from '@solana/web3.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { verifyUserAuthorization } from '../common/helpers/authorization.helper';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
    constructor(private walletService: WalletService) {}

    @Post("upgrade/:userId")
    async upgradeToPremium(@Request() req, @Response() res, @Param('userId') userId: string, @Body() data: { amount: number }) {
        try {
            await verifyUserAuthorization(req.user, userId, 'premium upgrade');
            const result = await this.walletService.payPremium(userId, data.amount);
            return res.status(200).json({ 
                message: 'Premium upgrade successful', 
                result,
                subscriptionType: result.type,
                currency: result.currency
            });
        } catch (error) {
            console.error('Error upgrading to premium:', error);
            return res.status(500).json({ message: error.message || 'Failed to upgrade to premium' });
        }
    }

    @Get("balance/:publicKey")
    async getBalance(@Response() res, @Param('publicKey') publicKey: string) {
        try {
            const balance = await this.walletService.getBalance(new PublicKey(publicKey));
            return res.status(200).json({ balance });
        } catch (error) {
            console.error('Error fetching balance:', error);
            return res.status(500).json({ message: error.message || 'Failed to fetch balance' });      
        }
    }

    @Get("earnings/:userId")
    async getUserEarnings(@Request() req, @Response() res, @Param('userId') userId: string) {
        try {
            await verifyUserAuthorization(req.user, userId, 'viewing earnings');
            const earnings = await this.walletService.getUserEarnings(userId);
            return res.status(200).json({ earnings });
        } catch (error) {
            console.error('Error fetching user earnings:', error);
            return res.status(500).json({ message: error.message || 'Failed to fetch user earnings' });
        }
    }

    @Post("swap")
    async swapSolToEDLN(@Request() req, @Response() res, @Body() data: {userId: string, amount: number}) {
        try {
            await verifyUserAuthorization(req.user, data.userId, 'token swap');
            const response = await this.walletService.swapSolToEdln(data.userId, data.amount)
            return res.status(200).json({response})
        } catch(error) {
            console.error("Error swapping sol to edln", error)
            return res.status(500).json({message: error.message || "Failed to swap SOL to EDLN"})
        }
    }
    
    @Post("burn")
    async burnEDLN(@Request() req, @Response() res, @Body() data: {userId: string, amount: number}) {
        try {
            await verifyUserAuthorization(req.user, data.userId, 'token burning');
            const signature = await this.walletService.burnEDLN(data.userId, data.amount);
            return res.status(200).json({
                message: 'EDLN tokens burned successfully',
                signature,
                transactionLink: `https://solscan.io/tx/${signature}`
            });
        } catch(error) {
            console.error("Error burning EDLN tokens", error);
            return res.status(500).json({message: error.message || "Failed to burn EDLN tokens"});
        }
    }

    @Post("earnings/claim")
    async claimEarnings(@Request() req, @Response() res, @Body() data: {userId: string, type: 'sol' | 'edln' | 'all'}) {
        try {
            await verifyUserAuthorization(req.user, data.userId, 'claiming earnings');
            const result = await this.walletService.claimEarnings(data.userId, data.type);
            return res.status(200).json(result);
        } catch(error) {
            console.error("Error claiming earnings", error);
            return res.status(500).json({message: error.message || "Failed to claim earnings"});
        }
    }

    @Post("decrypt-private-key")
    async decryptPrivateKey(@Request() req, @Response() res, @Body() data: {userId: string}) {
        try {
            await verifyUserAuthorization(req.user, data.userId, 'decrypting private key');
            const result = await this.walletService.decryptPrivateKey(data.userId);
            return res.status(200).json({
                publicKey: result.publicKey.toString(),
                privateKey: result.privateKey,
                success: true
            });
        } catch(error) {
            console.error("Error decrypting private key", error);
            return res.status(500).json({message: error.message || "Failed to decrypt private key", success: false});
        }
    }
}
