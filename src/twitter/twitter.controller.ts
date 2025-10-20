import { Body, Controller, Post, Get, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { TwitterService } from './twitter.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('twitter')
export class TwitterController {
  constructor(private readonly twitterService: TwitterService) {}

  @Post("callback")
  @UseGuards(JwtAuthGuard)
  async callback(@Body("data") data: {code: string, userEmail: string, redirectUri?: string, providedCodeVerifier?: string}) {
    try {
      if (!data.code || !data.userEmail) {
        throw new HttpException('Missing required parameters', HttpStatus.BAD_REQUEST);
      }
      
      const accessToken = await this.twitterService.getAccessToken(
        data.code, 
        data.redirectUri, 
        data.providedCodeVerifier
      );
      const profile = await this.twitterService.getUserProfile(accessToken, data.userEmail);
      return profile;
    } catch (error) {
      throw new HttpException(
        error.message || 'Failed to process Twitter callback', 
        error.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}

