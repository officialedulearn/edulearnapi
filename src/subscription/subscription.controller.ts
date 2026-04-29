import {
  Controller,
  Post,
  Body,
  Headers,
  Param,
  UnauthorizedException,
  Logger,
  HttpCode,
  BadRequestException,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { verifyUserAuthorization } from '../common/helpers/authorization.helper';
import { Throttle } from '@nestjs/throttler';

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
    entitlement_ids?: string[];
    presented_offering_id?: string;
  };
}

@Controller('subscription')
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
  ) {}

  @Throttle({ default: { limit: 100, ttl: 60_000 } })
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
        throw new UnauthorizedException(
          'Webhook authentication not configured',
        );
      }

      this.logger.debug(
        `Expected auth format: Bearer ${expectedAuth.substring(0, 10)}...`,
      );
      this.logger.debug(
        `Received auth header: ${authHeader ? authHeader.substring(0, 20) + '...' : 'MISSING'}`,
      );

      if (!authHeader) {
        this.logger.warn(
          'Unauthorized webhook attempt: No authorization header provided',
        );
        throw new UnauthorizedException('Authorization header is required');
      }

      if (authHeader !== `Bearer ${expectedAuth}`) {
        this.logger.warn(
          'Unauthorized webhook attempt: Invalid authorization header',
        );
        throw new UnauthorizedException('Invalid authorization header');
      }

      this.logger.log('Webhook authorization successful');

      this.logger.log(
        `Received RevenueCat webhook: ${payload.event.type} for user ${payload.event.app_user_id}, product: ${payload.event.product_id}`,
      );

      const { type, app_user_id, expiration_at_ms, product_id } = payload.event;

      const isBadgeClaim = product_id === 'rc_badge_claim1';
      const isStreakShield = product_id?.includes('streak_shield');
      const isQuizRefresh = product_id?.includes('quiz_refresh');

      if (isStreakShield) {
        if (type === 'INITIAL_PURCHASE' || type === 'NON_RENEWING_PURCHASE') {
          const result =
            await this.subscriptionService.handleStreakShieldPurchase(
              app_user_id,
              product_id,
            );
          return { received: true, type: 'streak_shield', ...result };
        }
        return { received: true };
      }

      if (isQuizRefresh) {
        if (type === 'INITIAL_PURCHASE' || type === 'NON_RENEWING_PURCHASE') {
          const result =
            await this.subscriptionService.handleQuizRefreshPurchase(
              app_user_id,
            );
          return { received: true, type: 'quiz_refresh', ...result };
        }
        return { received: true };
      }

      if (isBadgeClaim) {
        this.logger.log(
          `Badge claim purchase detected for user ${app_user_id}, product: ${product_id}`,
        );
        const result = await this.subscriptionService.handleBadgeClaim(
          app_user_id,
          product_id as string,
          payload,
        );
        return { received: true, type: 'badge_claim', ...result };
      }

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
          this.logger.log(
            `NON_RENEWING_PURCHASE for non-badge product: ${product_id}`,
          );
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

  @Post('purchase/streak-shield/:userId')
  @UseGuards(JwtAuthGuard)
  async purchaseStreakShield(
    @Request() req: { user: any },
    @Param('userId') userId: string,
  ) {
    await verifyUserAuthorization(req.user, userId, 'streak shield purchase');
    const result =
      await this.subscriptionService.purchaseStreakShieldViaApi(userId);
    return { ...result, success: true };
  }

  @Post('purchase/quiz-refresh/:userId')
  @UseGuards(JwtAuthGuard)
  async purchaseQuizRefresh(
    @Request() req: { user: any },
    @Param('userId') userId: string,
  ) {
    await verifyUserAuthorization(req.user, userId, 'quiz refresh purchase');
    const result =
      await this.subscriptionService.purchaseQuizRefreshViaApi(userId);
    return { ...result, success: true };
  }
}
