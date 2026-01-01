import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Body,
  Put,
} from '@nestjs/common';
import { SocialService } from './social.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getDatabaseUserId } from '../common/helpers/authorization.helper';

@Controller('social')
@UseGuards(JwtAuthGuard)
export class SocialController {
  constructor(private readonly socialService: SocialService) {}

  @Post('follow/:userId')
  @HttpCode(HttpStatus.OK)
  async followUser(
    @Request() req,
    @Param('userId') userId: string,
    @Body()
    body?: {
      emailNotifications?: boolean;
      pushNotifications?: boolean;
      inAppNotifications?: boolean;
    },
  ) {
    const followerId = await getDatabaseUserId(req.user);
    await this.socialService.followUser(followerId, userId, body);
    return { message: 'Successfully followed user' };
  }

  @Delete('unfollow/:userId')
  @HttpCode(HttpStatus.OK)
  async unfollowUser(@Request() req, @Param('userId') userId: string) {
    const followerId = await getDatabaseUserId(req.user);
    await this.socialService.unfollowUser(followerId, userId);
    return { message: 'Successfully unfollowed user' };
  }

  @Get('followers/:userId')
  async getFollowers(@Param('userId') userId: string) {
    const followers = await this.socialService.getFollowers(userId);
    return { followers };
  }

  @Get('following/:userId')
  async getFollowing(@Param('userId') userId: string) {
    const following = await this.socialService.getFollowing(userId);
    return { following };
  }

  @Get('stats/:userId')
  async getFollowStats(@Param('userId') userId: string) {
    const stats = await this.socialService.getFollowStats(userId);
    return stats;
  }

  @Get('is-following/:userId')
  async isFollowing(@Request() req, @Param('userId') userId: string) {
    const followerId = await getDatabaseUserId(req.user);
    const isFollowing = await this.socialService.isFollowing(followerId, userId);
    return { isFollowing };
  }

  @Put('notification-preferences/:userId')
  @HttpCode(HttpStatus.OK)
  async updateNotificationPreferences(
    @Request() req,
    @Param('userId') userId: string,
    @Body()
    preferences: {
      emailNotifications?: boolean;
      pushNotifications?: boolean;
      inAppNotifications?: boolean;
    },
  ) {
    const followerId = await getDatabaseUserId(req.user);
    await this.socialService.updateNotificationPreferences(
      followerId,
      userId,
      preferences,
    );
    return { message: 'Notification preferences updated successfully' };
  }

  @Get('notification-preferences/:userId')
  async getNotificationPreferences(
    @Request() req,
    @Param('userId') userId: string,
  ) {
    const followerId = await getDatabaseUserId(req.user);
    const preferences = await this.socialService.getNotificationPreferences(
      followerId,
      userId,
    );
    return preferences;
  }
}

