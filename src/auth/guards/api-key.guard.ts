import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly validKey = process.env.MOBILE_API_KEY;

  constructor() {
    if (!this.validKey) {
      console.warn('WARNING: MOBILE_API_KEY environment variable is not set. API endpoints requiring authentication will reject all requests.');
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'];

    // Check if API key is provided
    if (!apiKey) {
      throw new UnauthorizedException('API key is missing');
    }
    
    // Check if environment variable is defined
    if (!this.validKey) {
      throw new UnauthorizedException('API authentication is misconfigured');
    }

    // Check if API key is valid
    if (apiKey !== this.validKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
