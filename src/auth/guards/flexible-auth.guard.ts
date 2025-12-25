import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import db from '../../../drizzle';
import { user } from '../../../lib/db/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class FlexibleAuthGuard implements CanActivate {
  private marketplaceUser: any = null;
  private lastFetchTime = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    
    const marketplaceApiKey = request.headers['x-marketplace-key'] as string;
    if (marketplaceApiKey) {
      return await this.validateMarketplaceApiKey(marketplaceApiKey, request);
    }

    const reviewerApiKey = request.headers['x-reviewer-key'] as string;
    if (reviewerApiKey && reviewerApiKey === process.env.REVIEWER_API_KEY) {
      request['user'] = { 
        email: 'playreview@edulearn.com',
        role: 'reviewer',
        sub: 'reviewer-user'
      };
      return true;
    }

    return await this.validateJwtToken(request);
  }

  private async validateMarketplaceApiKey(apiKey: string, request: Request): Promise<boolean> {
    const validKey = process.env.MARKETPLACE_API_KEY;
    
    if (!validKey) {
      throw new UnauthorizedException('Marketplace API authentication is misconfigured');
    }
    
    if (apiKey !== validKey) {
      throw new UnauthorizedException('Invalid marketplace API key');
    }

    const now = Date.now();
    if (!this.marketplaceUser || (now - this.lastFetchTime > this.CACHE_DURATION)) {
      let users;
      try {
        users = await db
          .select()
          .from(user)
          .where(eq(user.email, 'marketplace@edulearn.com'))
          .limit(1);
      } catch (error: any) {
        const isConnectionError = 
          error?.cause?.code === 'XX000' ||
          error?.cause?.message?.includes('Tenant or user not found') ||
          error?.code === 'ECONNRESET';
        
        if (isConnectionError) {
          await new Promise(resolve => setTimeout(resolve, 500));
          users = await db
            .select()
            .from(user)
            .where(eq(user.email, 'marketplace@edulearn.com'))
            .limit(1);
        } else {
          throw error;
        }
      }

      if (!users.length) {
        throw new UnauthorizedException('Marketplace user not found in database. Please create the marketplace user account first.');
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

  private async validateJwtToken(request: Request): Promise<boolean> {
    const token = this.extractTokenFromHeader(request);
    
    if (!token) {
      throw new UnauthorizedException('Authentication required: Provide either a JWT token or marketplace API key');
    }
    
    try {
      const jwtSecret = process.env.SUPABASE_JWT_SECRET;
      if (!jwtSecret) {
        console.warn('WARNING: SUPABASE_JWT_SECRET environment variable is not set.');
        throw new UnauthorizedException('JWT authentication is misconfigured');
      }

      const payload = jwt.verify(token, jwtSecret);
      request['user'] = payload;
      
      return true;
    } catch (error) {
      console.error('JWT validation error:', error.message);
      throw new UnauthorizedException('Invalid authentication token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

