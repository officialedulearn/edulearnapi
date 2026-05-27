import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import db from '../../../drizzle';
import { user } from '../../../lib/db/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class MarketplaceApiKeyGuard implements CanActivate {
  private readonly validKey = process.env.MARKETPLACE_API_KEY;
  private marketplaceUser: any = null;
  private lastFetchTime = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000;

  constructor() {
    if (!this.validKey) {
      console.warn(
        'WARNING: MARKETPLACE_API_KEY environment variable is not set. Marketplace endpoints requiring authentication will reject all requests.',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    // Check both header and query param (query param needed for EventSource which can't send headers)
    const q = request.query as Record<string, unknown>;
    const apiKey =
      request.headers['x-marketplace-key'] ||
      (q['apiKey'] as string | undefined);

    if (!apiKey) {
      throw new UnauthorizedException(
        'Marketplace API key is missing (provide via x-marketplace-key header or apiKey query parameter)',
      );
    }

    if (!this.validKey) {
      throw new UnauthorizedException(
        'Marketplace API authentication is misconfigured',
      );
    }

    if (apiKey !== this.validKey) {
      throw new UnauthorizedException('Invalid marketplace API key');
    }

    const now = Date.now();
    if (
      !this.marketplaceUser ||
      now - this.lastFetchTime > this.CACHE_DURATION
    ) {
      const users = await db
        .select()
        .from(user)
        .where(eq(user.email, 'marketplace@edulearn.com'))
        .limit(1);

      if (!users.length) {
        throw new UnauthorizedException(
          'Marketplace user not found in database. Please create the marketplace user account first.',
        );
      }

      this.marketplaceUser = users[0];
      this.lastFetchTime = now;
    }

    request['user'] = {
      email: this.marketplaceUser.email,
      sub: this.marketplaceUser.id,
      id: this.marketplaceUser.id,
      role: 'marketplace',
    };

    return true;
  }
}
