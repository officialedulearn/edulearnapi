import { Body, Controller, Post, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { TwitterService } from './twitter.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('twitter')
@UseGuards(JwtAuthGuard)
export class TwitterController {
  constructor(private readonly twitterService: TwitterService) {}

  @Post("callback")
  async callback(@Body("data") data: {code: string, userEmail: string, redirectUri?: string, providedCodeVerifier?: string}) {
    try {
      if (!data.code || !data.userEmail) {
        throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
      }
      console.log('Received Twitter callback with code and email');
      const accessToken = await this.twitterService.getAccessToken(data.code, data.redirectUri);
      const profile = await this.twitterService.getUserProfile(accessToken, data.userEmail);
      return profile;
    } catch (error) {
      console.error('Twitter callback error:', error);
      throw new HttpException(
        error.message || 'Failed to process Twitter authorization', 
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

