import {
  Body,
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { UserSettingsPreferences } from 'lib/db/schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getDatabaseUserId } from '../common/helpers/authorization.helper';
import { UserService } from './user.service';

@Throttle({ default: { limit: 40, ttl: 60_000 } })
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  async getSettings(@Request() req) {
    const userId = await getDatabaseUserId(req.user);
    return this.userService.getUserSettings(userId);
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard)
  async updateSettings(
    @Request() req,
    @Body() body: Partial<UserSettingsPreferences>,
  ) {
    const userId = await getDatabaseUserId(req.user);
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
  async getUserById(@Param('userId') userId: string) {
    try {
      return await this.userService.getUserById(userId);
    } catch (e) {
      if (e instanceof Error && e.message === 'User not found') {
        throw new NotFoundException('User not found');
      }
      throw e;
    }
  }
}
