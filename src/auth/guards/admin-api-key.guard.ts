import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  private readonly validKey = process.env.ADMIN_API_KEY;

  constructor() {
    if (!this.validKey) {
      console.warn(
        'WARNING: ADMIN_API_KEY environment variable is not set. Admin endpoints requiring authentication will reject all requests.',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const q = request.query as Record<string, unknown>;
    const apiKey =
      request.headers['x-admin-key'] || (q['adminKey'] as string | undefined);

    if (!apiKey) {
      throw new UnauthorizedException(
        'Admin API key is missing (provide via x-admin-key header or adminKey query parameter)',
      );
    }

    if (!this.validKey) {
      throw new UnauthorizedException(
        'Admin API authentication is misconfigured',
      );
    }

    if (apiKey !== this.validKey) {
      throw new UnauthorizedException('Invalid admin API key');
    }

    request['user'] = {
      email: 'admin@edulearn.com',
      role: 'admin',
    };

    return true;
  }
}
