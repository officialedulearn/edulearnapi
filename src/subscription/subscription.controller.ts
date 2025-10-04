import {
  Controller,
  Post,
  Body,
  Headers,
  UnauthorizedException,
  Logger,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { ConfigService } from '@nestjs/config';

interface RevenueCatWebhookEvent {
  api_version: string;
  event: {
    type: string;
    app_user_id: string;
    product_id?: string;
    period_type?: string;
    purchased_at_ms?: number;
    expiration_at_ms?: number;
    store?: string;
    environment?: string;
  };
}

@Controller('subscription')
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
  ) {}

  @Post('revenuecat/webhook')
  @HttpCode(200)
  async handleRevenueCatWebhook(
    @Headers('authorization') authHeader: string,
    @Body() payload: RevenueCatWebhookEvent,
  ) {
    try {
      const expectedAuth = this.configService.get<string>(
        'REVENUECAT_WEBHOOK_SECRET',
      );

      if (!expectedAuth) {
        this.logger.error(
          'REVENUECAT_WEBHOOK_SECRET not configured in environment variables',
        );
        throw new UnauthorizedException('Webhook authentication not configured');
      }

      if (!authHeader || authHeader !== `Bearer ${expectedAuth}`) {
        this.logger.warn('Unauthorized webhook attempt');
        throw new UnauthorizedException('Invalid authorization header');
      }

      this.logger.log(
        `Received RevenueCat webhook: ${payload.event.type} for user ${payload.event.app_user_id}`,
      );

      const { type, app_user_id, expiration_at_ms } = payload.event;

      const expirationDate = expiration_at_ms
        ? new Date(expiration_at_ms).toISOString()
        : undefined;

      switch (type) {
        case 'INITIAL_PURCHASE':
          await this.subscriptionService.handleInitialPurchase(
            app_user_id,
            expirationDate,
          );
          break;

        case 'RENEWAL':
          await this.subscriptionService.handleRenewal(
            app_user_id,
            expirationDate,
          );
          break;

        case 'CANCELLATION':
          await this.subscriptionService.handleCancellation(app_user_id);
          break;

        case 'BILLING_ISSUE':
          await this.subscriptionService.handleBillingIssue(app_user_id);
          break;

        case 'EXPIRATION':
          await this.subscriptionService.handleExpiration(app_user_id);
          break;

        case 'PRODUCT_CHANGE':
          await this.subscriptionService.handleProductChange(
            app_user_id,
            expirationDate,
          );
          break;

        case 'NON_RENEWING_PURCHASE':
          await this.subscriptionService.handleInitialPurchase(
            app_user_id,
            expirationDate,
          );
          break;

        default:
          this.logger.warn(`Unhandled event type: ${type}`);
      }

      return { received: true };
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      this.logger.error('Error processing webhook', error.stack);
      throw new BadRequestException('Failed to process webhook');
    }
  }
}
