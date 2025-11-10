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
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { signUpDetails } from 'types/auth';
import { ApiKeyGuard } from './guards/api-key.guard';
import { FlexibleAuthGuard } from './guards/flexible-auth.guard';
import { getAuthenticatedUserId, verifyUserAuthorization } from '../common/helpers/authorization.helper';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('check-availability')
  async checkAvailability(@Body() body: { email?: string; username?: string }) {
    const { email, username } = body;
    
    if (!email && !username) {
      throw new BadRequestException('Either email or username is required');
    }

    const result = await this.authService.checkUserAvailability(email, username);
    return result;
  }

  @Post('signup')
  async signUp(@Body() data: signUpDetails) {
    const result = await this.authService.createUser(data);
    if (result instanceof Error) {
      throw new BadRequestException(result.message);
    }
    return result;
  }
  @Get('email/:email')
  @UseGuards(FlexibleAuthGuard)
  async getUserByEmail(@Param('email') email: string) {
    const user = await this.authService.getUserByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
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
  async editUser(@Body() body: { name: string; email: string, username: string, learning: string; }) {
    const { name, email, username, learning } = body;

    if (!name || !email) {
      throw new BadRequestException('Name and email are required');
    }

    const updatedUser = await this.authService.editUser({ name, email, username, learning });

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

  @Put('expo-push-token')
  @UseGuards(JwtAuthGuard)
  async updateExpoPushToken(
    @Request() req,
    @Body() body: { expoPushToken: string, userId: string }
  ) {

    await verifyUserAuthorization(req.user, body.userId, 'updating expo push token');
    if (!body.expoPushToken) throw new BadRequestException('Expo push token is required');
    return await this.authService.updateUserExpoPushToken(body.userId, body.expoPushToken);
  }
  @Put('streak/:userId')
  @UseGuards(FlexibleAuthGuard)
  async updateStreak(
    @Request() req,
    @Param('userId') userId: string,
    @Body() body: { streak: number }
  ) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (body.streak === undefined) throw new BadRequestException('Streak value is required');
    
    await verifyUserAuthorization(req.user, userId, 'updating streak');
    
    try {
      const newStreak = await this.authService.updateUserStreak(
        userId, 
        body.streak
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
    @Body() body: { level: 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'expert' }
  ) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (!body.level) throw new BadRequestException('Level is required');
    
    const validLevels = ['novice', 'beginner', 'intermediate', 'advanced', 'expert'];
    if (!validLevels.includes(body.level)) {
      throw new BadRequestException(`Level must be one of: ${validLevels.join(', ')}`);
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
    @Body() body: { credits: number }
  ) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (body.credits === undefined) throw new BadRequestException('Credits amount is required');
    
    if (body.credits > 3 || body.credits < -3) {
      throw new BadRequestException('Credits amount must be between -3 and 3');
    }
    
    await verifyUserAuthorization(req.user, userId, 'updating credits');
    
    try {
      const updatedCredits = await this.authService.incrementCredits(userId, body.credits);
      return { credits: updatedCredits };
    } catch (error) {
      throw new NotFoundException(error.message);
    }
  }

  @Get('search')
  @UseGuards(FlexibleAuthGuard)
  async searchUsers(@Query('username') username: string, @Query('limit') limit?: number) {
    if (!username) {
      throw new BadRequestException('Username query parameter is required');
    }
    
    const limitValue = limit ? parseInt(limit.toString(), 10) : 10;
    
    return this.authService.searchUsersByUsername(username, limitValue);
  }

  @Delete('user/:userId')
  @UseGuards(FlexibleAuthGuard)
  async deleteUser(@Request() req, @Param('userId') userId: string, @Query('supabaseUserId') supabaseUserId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    await verifyUserAuthorization(req.user, userId, 'deleting account');
    
    try {
      const result = await this.authService.deleteUserDataAsync(userId, supabaseUserId);
      return result;
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      throw new BadRequestException('Failed to initiate user deletion');
    }
  }
}
