import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Response,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { PublicKey } from '@solana/web3.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { verifyUserAuthorization } from '../common/helpers/authorization.helper';
import { DeviceInfo, OnrampWebhookData } from './wallet.service';
import { AuthService } from '../auth/auth.service';

@Controller('wallet')
export class WalletController {
  constructor(
    private walletService: WalletService,
    private authService: AuthService,
  ) {}

  @Post('onramp/initiate/:userId')
  @UseGuards(JwtAuthGuard)
  async initiateOnramp(
    @Request() req,
    @Response() res,
    @Param('userId') userId: string,
  ) {
    try {
      await verifyUserAuthorization(req.user, userId, 'initiate onramp');
      const result = await this.walletService.initiateOnramp(userId);
      return res.status(200).json({
        message: 'Onramp initiated successfully',
        result,
      });
    } catch (error) {
      console.error('Error initiating onramp:', error);
      return res
        .status(500)
        .json({ message: error.message || 'Failed to initiate onramp' });
    }
  }

  @Post('onramp/verify')
  async verifyOnramp(
    @Response() res,
    @Body() data: { email: string; otp: string; deviceInfo: DeviceInfo },
  ) {
    try {
      const verifiedResponse = await this.walletService.verifyOnramp(
        data.email,
        data.otp,
        data.deviceInfo,
      );
      return res.status(200).json({
        message: 'Onramp verified successfully',
        verifiedResponse,
      });
    } catch (error) {
      console.error('Error verifying onramp:', error);
      return res
        .status(500)
        .json({ message: error.message || 'Failed to verify onramp' });
    }
  }

  @Post('onramp/create-order/:userId')
  @UseGuards(JwtAuthGuard)
  async onrampFiatToEdln(
    @Request() req,
    @Response() res,
    @Param('userId') userId: string,
    @Body() data: { amount: number; verifiedResponse: any },
  ) {
    try {
      await verifyUserAuthorization(req.user, userId, 'create onramp order');
      const order = await this.walletService.onrampFiatToEdln(
        userId,
        data.amount,
        data.verifiedResponse,
      );
      return res.status(200).json({
        message: 'Order created successfully',
        order,
      });
    } catch (error) {
      console.error('Error creating onramp order:', error);
      return res
        .status(500)
        .json({ message: error.message || 'Failed to create onramp order' });
    }
  }

  @Post('onramp/create-order-sol/:userId')
  @UseGuards(JwtAuthGuard)
  async onrampFiatToSol(
    @Request() req,
    @Response() res,
    @Param('userId') userId: string,
    @Body() data: { amount: number; verifiedResponse: any },
  ) {
    try {
      await verifyUserAuthorization(req.user, userId, 'create onramp order');
      const order = await this.walletService.onrampFiatToSol(
        userId,
        data.amount,
        data.verifiedResponse,
      );
      return res.status(200).json({
        message: 'Order created successfully',
        order,
      });
    } catch (error) {
      console.error('Error creating onramp order:', error);
      return res
        .status(500)
        .json({ message: error.message || 'Failed to create onramp order' });
    }
  }

  @Post('onramp-webhook')
  @HttpCode(200)
  async onrampWebhook(@Request() req) {
    try {
      const raw = req.rawBody?.toString();

      console.log('Raw Body:', raw);

      const webhookData = JSON.parse(raw);

      console.log('=== Webhook Parsed ===');
      console.log(webhookData);

      await this.walletService.processWebhookEvent(webhookData);

      return {
        success: true,
        message: 'Webhook received successfully',
      };
    } catch (error) {
      console.error('Error processing onramp webhook:', error);
      throw error;
    }
  }

  @Get('onramp-webhook/pending/:address')
  @UseGuards(JwtAuthGuard)
  async getPendingWebhookEvents(
    @Response() res,
    @Param('address') address: string,
  ) {
    try {
      const events = this.walletService.getPendingWebhookEvents(address);
      return res.status(200).json({
        events,
        hasUpdates: events.length > 0,
      });
    } catch (error) {
      console.error('Error fetching pending webhook events:', error);
      return res.status(500).json({
        message: error.message || 'Failed to fetch pending events',
      });
    }
  }

  @Post('onramp-webhook/clear/:address')
  @UseGuards(JwtAuthGuard)
  async clearWebhookEvent(
    @Response() res,
    @Param('address') address: string,
    @Body() data: { eventId: string },
  ) {
    try {
      this.walletService.clearWebhookEvent(address, data.eventId);
      return res.status(200).json({
        success: true,
        message: 'Webhook event cleared',
      });
    } catch (error) {
      console.error('Error clearing webhook event:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to clear webhook event',
      });
    }
  }

  @Post('upgrade/:userId')
  @UseGuards(JwtAuthGuard)
  async upgradeToPremium(
    @Request() req,
    @Response() res,
    @Param('userId') userId: string,
    @Body() data: { amount: number },
  ) {
    try {
      await verifyUserAuthorization(req.user, userId, 'premium upgrade');
      const result = await this.walletService.payPremium(userId, data.amount);
      return res.status(200).json({
        message: 'Premium upgrade successful',
        result,
        subscriptionType: result.type,
        currency: result.currency,
      });
    } catch (error) {
      console.error('Error upgrading to premium:', error);
      return res
        .status(500)
        .json({ message: error.message || 'Failed to upgrade to premium' });
    }
  }

  @Get('balance/:publicKey')
  @UseGuards(JwtAuthGuard)
  async getBalance(@Response() res, @Param('publicKey') publicKey: string) {
    try {
      const balance = await this.walletService.getBalance(
        new PublicKey(publicKey),
      );
      return res.status(200).json({ balance });
    } catch (error) {
      console.error('Error fetching balance:', error);
      return res
        .status(500)
        .json({ message: error.message || 'Failed to fetch balance' });
    }
  }

  @Get('earnings/:userId')
  @UseGuards(JwtAuthGuard)
  async getUserEarnings(
    @Request() req,
    @Response() res,
    @Param('userId') userId: string,
  ) {
    try {
      await verifyUserAuthorization(req.user, userId, 'viewing earnings');
      const earnings = await this.walletService.getUserEarnings(userId);
      return res.status(200).json({ earnings });
    } catch (error) {
      console.error('Error fetching user earnings:', error);
      return res
        .status(500)
        .json({ message: error.message || 'Failed to fetch user earnings' });
    }
  }

  @Post('swap')
  @UseGuards(JwtAuthGuard)
  async swapSolToEDLN(
    @Request() req,
    @Response() res,
    @Body() data: { userId: string; amount: number },
  ) {
    try {
      await verifyUserAuthorization(req.user, data.userId, 'token swap');
      const response = await this.walletService.swapSolToEdln(
        data.userId,
        data.amount,
      );
      return res.status(200).json({ response });
    } catch (error) {
      console.error('Error swapping sol to edln', error);
      return res
        .status(500)
        .json({ message: error.message || 'Failed to swap SOL to EDLN' });
    }
  }

  @Post('burn')
  @UseGuards(JwtAuthGuard)
  async burnEDLN(
    @Request() req,
    @Response() res,
    @Body() data: { userId: string; amount: number },
  ) {
    try {
      await verifyUserAuthorization(req.user, data.userId, 'token burning');
      const signature = await this.walletService.burnEDLN(
        data.userId,
        data.amount,
      );

      switch (data.amount) {
        case 1000:
          await this.authService.incrementCredits(
            data.userId as unknown as string,
            3,
          );
          break;
        case 5000:
          await this.authService.incrementCredits(
            data.userId as unknown as string,
            10,
          );
          break;
        case 10000:
          await this.authService.incrementCredits(
            data.userId as unknown as string,
            20,
          );
          break;
        default:
          break;
      }
      return res.status(200).json({
        message: 'EDLN tokens burned successfully',
        signature,
        transactionLink: `https://solscan.io/tx/${signature}`,
      });
    } catch (error) {
      console.error('Error burning EDLN tokens', error);
      return res
        .status(500)
        .json({ message: error.message || 'Failed to burn EDLN tokens' });
    }
  }

  @Post('earnings/claim')
  @UseGuards(JwtAuthGuard)
  async claimEarnings(
    @Request() req,
    @Response() res,
    @Body() data: { userId: string; type: 'sol' | 'edln' | 'all' },
  ) {
    try {
      await verifyUserAuthorization(req.user, data.userId, 'claiming earnings');
      const result = await this.walletService.claimEarnings(
        data.userId,
        data.type,
      );
      return res.status(200).json(result);
    } catch (error) {
      console.error('Error claiming earnings', error);
      return res
        .status(500)
        .json({ message: error.message || 'Failed to claim earnings' });
    }
  }

  @Post('decrypt-private-key')
  @UseGuards(JwtAuthGuard)
  async decryptPrivateKey(
    @Request() req,
    @Response() res,
    @Body() data: { userId: string },
  ) {
    try {
      await verifyUserAuthorization(
        req.user,
        data.userId,
        'decrypting private key',
      );
      const result = await this.walletService.decryptPrivateKey(data.userId);
      return res.status(200).json({
        publicKey: result.publicKey.toString(),
        privateKey: result.privateKey,
        success: true,
      });
    } catch (error) {
      console.error('Error decrypting private key', error);
      return res.status(500).json({
        message: error.message || 'Failed to decrypt private key',
        success: false,
      });
    }
  }
}
