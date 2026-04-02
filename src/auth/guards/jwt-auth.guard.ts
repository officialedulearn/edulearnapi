import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    // Check for reviewer bypass first
    const reviewerApiKey = request.headers['x-reviewer-key'] as string;
    if (reviewerApiKey && reviewerApiKey === process.env.REVIEWER_API_KEY) {
      // Set a mock user for reviewer requests
      request['user'] = {
        email: 'playreview@edulearn.com',
        role: 'reviewer',
        sub: 'reviewer-user',
      };
      return true;
    }

    if (!token) {
      throw new UnauthorizedException('JWT token is missing');
    }

    try {
      const jwtSecret = process.env.SUPABASE_JWT_SECRET;
      if (!jwtSecret) {
        console.warn(
          'WARNING: SUPABASE_JWT_SECRET environment variable is not set.',
        );
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
