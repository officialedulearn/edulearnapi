import {
  Body,
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { UserSettingsPreferences } from 'lib/db/schema';
import { FlexibleAuthGuard } from '../auth/guards/flexible-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserService } from './user.service';

@Throttle({ default: { limit: 40, ttl: 60_000 } })
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  private getOptionalAuthenticatedUserId(
    authenticatedUser: any,
  ): string | undefined {
    if (
      !authenticatedUser ||
      authenticatedUser.role === 'reviewer' ||
      authenticatedUser.role === 'marketplace'
    ) {
      return undefined;
    }

    return (
      authenticatedUser.sub ||
      authenticatedUser.id ||
      authenticatedUser.user?.id ||
      authenticatedUser.user_metadata?.sub
    );
  }

  private requireAuthenticatedUserId(authenticatedUser: any): string {
    const userId = this.getOptionalAuthenticatedUserId(authenticatedUser);
    if (!userId) {
      throw new UnauthorizedException('Invalid authentication token');
    }

    return userId;
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  async getSettings(@Request() req) {
    const userId = this.requireAuthenticatedUserId(req.user);
    return this.userService.getUserSettings(userId);
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard)
  async updateSettings(
    @Request() req,
    @Body() body: Partial<UserSettingsPreferences>,
  ) {
    const userId = this.requireAuthenticatedUserId(req.user);
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Settings payload is required');
    }

    return this.userService.updateUserSettings(userId, body);
  }

  @Get(':userId/memory')
  getUserMemory(@Param('userId') userId: string) {
    return this.userService.getUserMemory(userId);
  }

  @Get(':userId')
  @UseGuards(FlexibleAuthGuard)
  async getUserById(@Request() req, @Param('userId') userId: string) {
    try {
      const viewerId = this.getOptionalAuthenticatedUserId(req.user);

      const user = await this.userService.getUserById(userId, viewerId);
      if (!user) {
        throw new NotFoundException('User not found');
      }
      return user;
    } catch (e) {
      if (e instanceof Error && e.message === 'User not found') {
        throw new NotFoundException('User not found');
      }
      throw e;
    }
  }
}
