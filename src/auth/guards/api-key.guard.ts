import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly validKey = process.env.MOBILE_API_KEY;

  constructor() {
    if (!this.validKey) {
      console.warn(
        'WARNING: MOBILE_API_KEY environment variable is not set. API endpoints requiring authentication will reject all requests.',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }

    if (!this.validKey) {
      throw new UnauthorizedException('API authentication is misconfigured');
    }
    if (apiKey !== this.validKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
