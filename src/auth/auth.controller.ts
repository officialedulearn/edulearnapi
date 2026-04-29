import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  BadRequestException,
  NotFoundException,
  UseGuards,
  Request,
  HttpCode,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { signUpDetails } from 'types/auth';
import { FlexibleAuthGuard } from './guards/flexible-auth.guard';
import {
  verifyUserAuthorization,
} from '../common/helpers/authorization.helper';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Throttle } from '@nestjs/throttler';
import { UserResponse } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @HttpCode(200)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('check-availability')
  async checkAvailability(@Body() body: { email?: string; username?: string }) {
    const { email, username } = body;

    if (!email && !username) {
      throw new BadRequestException('Either email or username is required');
    }

    const result = await this.authService.checkUserAvailability(
      email,
      username,
    );
    return result;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signup')
  async signUp(@Body() data: signUpDetails) {
    const result = (await this.authService.createUser(
      data,
    )) as unknown as UserResponse;
    if (result instanceof Error) {
      throw new BadRequestException(result.message);
    }
    return result as UserResponse;
  }
  @Get('email/:email')
  @UseGuards(FlexibleAuthGuard)
  async getUserByEmail(@Param('email') email: string): Promise<UserResponse> {
    const user = (await this.authService.getUserByEmail(email)) as UserResponse;
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user as UserResponse;
  }

  @Get('id/:id')
  @UseGuards(FlexibleAuthGuard)
  async getUserById(@Request() req, @Param('id') id: string) {
    const user = await this.authService.getUserById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  @Put('edit')
  @UseGuards(FlexibleAuthGuard)
  async editUser(
    @Body()
    body: {
      name: string;
      email: string;
      username: string;
      learning: string;
    },
  ) {
    const { name, email, username, learning } = body;

    if (!name || !email) {
      throw new BadRequestException('Name and email are required');
    }

    const updatedUser = await this.authService.editUser({
      name,
      email,
      username,
      learning,
    });

    if (!updatedUser) {
      throw new BadRequestException('User not found or update failed');
    }

    return updatedUser;
  }

  @Put('address')
  @UseGuards(FlexibleAuthGuard)
  async updateUserAddress(
    @Query('email') email: string,
    @Query('address') address: string,
  ) {
    if (!email || !address) {
      throw new BadRequestException('Missing email or address');
    }
    return await this.authService.updateUserAddress(email, address);
  }

  @Post('referral')
  @UseGuards(FlexibleAuthGuard)
  async incrementReferral(@Query('code') code: string) {
    if (!code) throw new BadRequestException('Referral code is required');
    const name = await this.authService.incrementReferralCount(code);
    if (!name) throw new NotFoundException('Referral code not found');
    return { referrer: name };
  }

  @Get('leaderboard')
  @UseGuards(FlexibleAuthGuard)
  async getLeaderboard() {
    try {
      const users = await this.authService.getAllUsersAndXP();
      return { users };
    } catch (error) {
      throw new BadRequestException('Failed to fetch leaderboard');
    }
  }

  @Get('weekly-leaderboard')
  @UseGuards(FlexibleAuthGuard)
  async getWeeklyLeaderboard(@Query('week') week?: string) {
    try {
      const weekStart = week ? new Date(week) : undefined;
      return this.authService.getWeeklyLeaderboard(weekStart);
    } catch (error) {
      throw new BadRequestException('Failed to fetch weekly leaderboard');
    }
  }

  @Put('expo-push-token')
  @UseGuards(JwtAuthGuard)
  async updateExpoPushToken(
    @Request() req,
    @Body() body: { expoPushToken: string; userId: string },
  ) {
    await verifyUserAuthorization(
      req.user,
      body.userId,
      'updating expo push token',
    );
    if (!body.expoPushToken)
      throw new BadRequestException('Expo push token is required');
    return await this.authService.updateUserExpoPushToken(
      body.userId,
      body.expoPushToken,
    );
  }
  @Put('streak/:userId')
  @UseGuards(FlexibleAuthGuard)
  async updateStreak(
    @Request() req,
    @Param('userId') userId: string,
    @Body() body: { streak: number },
  ) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (body.streak === undefined)
      throw new BadRequestException('Streak value is required');

    await verifyUserAuthorization(req.user, userId, 'updating streak');

    try {
      const newStreak = await this.authService.updateUserStreak(
        userId,
        body.streak,
      );
      return { streak: newStreak };
    } catch (error) {
      throw new NotFoundException(error.message);
    }
  }

  @Put('level/:userId')
  @UseGuards(FlexibleAuthGuard)
  async setLevel(
    @Request() req,
    @Param('userId') userId: string,
    @Body()
    body: {
      level: 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'expert';
    },
  ) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (!body.level) throw new BadRequestException('Level is required');

    const validLevels = [
      'novice',
      'beginner',
      'intermediate',
      'advanced',
      'expert',
    ];
    if (!validLevels.includes(body.level)) {
      throw new BadRequestException(
        `Level must be one of: ${validLevels.join(', ')}`,
      );
    }

    await verifyUserAuthorization(req.user, userId, 'setting level');

    try {
      const newLevel = await this.authService.setUserLevel(userId, body.level);
      return { level: newLevel };
    } catch (error) {
      throw new NotFoundException(error.message);
    }
  }

  @Put('credits/:userId')
  @UseGuards(FlexibleAuthGuard)
  async updateCredits(
    @Request() req,
    @Param('userId') userId: string,
    @Body() body: { credits: number },
  ) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (body.credits === undefined)
      throw new BadRequestException('Credits amount is required');

    if (body.credits > 3 || body.credits < -3) {
      throw new BadRequestException('Credits amount must be between -3 and 3');
    }

    await verifyUserAuthorization(req.user, userId, 'updating credits');

    try {
      const updatedCredits = await this.authService.incrementCredits(
        userId,
        body.credits,
      );
      return { credits: updatedCredits };
    } catch (error) {
      throw new NotFoundException(error.message);
    }
  }

  @Get('search')
  @UseGuards(FlexibleAuthGuard)
  async searchUsers(
    @Query('username') username: string,
    @Query('limit') limit?: number,
  ) {
    if (!username) {
      throw new BadRequestException('Username query parameter is required');
    }

    const limitValue = limit ? parseInt(limit.toString(), 10) : 10;

    return this.authService.searchUsersByUsername(username, limitValue);
  }

  @Delete('user/:userId')
  @UseGuards(FlexibleAuthGuard)
  async deleteUser(
    @Request() req,
    @Param('userId') userId: string,
    @Query('supabaseUserId') supabaseUserId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    await verifyUserAuthorization(req.user, userId, 'deleting account');

    try {
      const result = await this.authService.deleteUserDataAsync(
        userId,
        supabaseUserId,
      );
      return result;
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      throw new BadRequestException('Failed to initiate user deletion');
    }
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('oauth/callback')
  async handleOAuthCallback(
    @Body()
    body: {
      supabaseUserId: string;
      email: string;
      name: string;
      provider: 'google' | 'apple';
      providerId: string;
    },
  ) {
    if (
      !body.supabaseUserId ||
      !body.email ||
      !body.provider ||
      !body.providerId
    ) {
      throw new BadRequestException('Missing required OAuth fields');
    }

    const result = await this.authService.handleOAuthUser({
      id: body.supabaseUserId,
      email: body.email,
      name: body.name || '',
      provider: body.provider,
      providerId: body.providerId,
    });

    return {
      ...result,
      message: result.isNewUser
        ? 'Account created successfully'
        : 'Logged in successfully',
    };
  }

  @Put('complete-profile')
  @UseGuards(FlexibleAuthGuard)
  async completeProfile(
    @Request() req,
    @Body() body: { userId: string; username: string },
  ) {
    if (!body.userId || !body.username) {
      throw new BadRequestException('User ID and username are required');
    }

    await verifyUserAuthorization(req.user, body.userId, 'completing profile');

    const availability = await this.authService.checkUserAvailability(
      undefined,
      body.username,
    );

    if (!availability.usernameAvailable) {
      throw new BadRequestException('Username already taken');
    }

    const updatedUser = await this.authService.updateUsername(
      body.userId,
      body.username,
    );

    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    return { success: true, user: updatedUser };
  }
}
