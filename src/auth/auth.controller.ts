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
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { signUpDetails } from 'types/auth';
import { ApiKeyGuard } from './guards/api-key.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Public endpoints that don't need authentication
  @Post('signup')
  async signUp(@Body() data: signUpDetails) {
    const result = await this.authService.createUser(data);
    if (result instanceof Error) {
      throw new BadRequestException(result.message);
    }
    return result;
  }

  // These endpoints should support both auth methods during transition
  // GET /auth/email/:email
  @Get('email/:email')
  @UseGuards(JwtAuthGuard)
  async getUserByEmail(@Param('email') email: string) {
    const user = await this.authService.getUserByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  // GET /auth/id/:id
  @Get('id/:id')
  @UseGuards(JwtAuthGuard)
  async getUserById(@Param('id') id: string) {
    const user = await this.authService.getUserById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
  
  @Put('edit')
  @UseGuards(JwtAuthGuard)
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

  // PUT /auth/address?email=someone@email.com&address=solanaWallet
  @Put('address')
  @UseGuards(JwtAuthGuard)
  async updateUserAddress(
    @Query('email') email: string,
    @Query('address') address: string,
  ) {
    if (!email || !address) {
      throw new BadRequestException('Missing email or address');
    }
    return await this.authService.updateUserAddress(email, address);
  }

  // POST /auth/referral?code=abc123
  @Post('referral')
  @UseGuards(JwtAuthGuard)
  async incrementReferral(@Query('code') code: string) {
    if (!code) throw new BadRequestException('Referral code is required');
    const name = await this.authService.incrementReferralCount(code);
    if (!name) throw new NotFoundException('Referral code not found');
    return { referrer: name };
  }

  // GET /auth/leaderboard
  @Get('leaderboard')
  // Public leaderboard endpoint
  async getLeaderboard() {
    try {
      const users = await this.authService.getAllUsersAndXP();
      return { users };
    } catch (error) {
      throw new BadRequestException('Failed to fetch leaderboard');
    }
  }

  // PUT /auth/xp/:userId
  @Put('xp/:userId')
  @UseGuards(JwtAuthGuard)
  async updateXP(
    @Param('userId') userId: string,
    @Body() body: { xp: number, title: string, type: "chat" | "quiz" | "streak" }
  ) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (body.xp === undefined) throw new BadRequestException('XP amount is required');
    
    try {
      const result = await this.authService.updateUserXP(userId, body.title, body.xp, body.type);
      return result;
    } catch (error) {
      throw new NotFoundException(error.message);
    }
  }

  // PUT /auth/streak/:userId
  @Put('streak/:userId')
  @UseGuards(JwtAuthGuard)
  async updateStreak(
    @Param('userId') userId: string,
    @Body() body: { streak: number }
  ) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (body.streak === undefined) throw new BadRequestException('Streak value is required');
    
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

  // PUT /auth/level/:userId
  @Put('level/:userId')
  @UseGuards(JwtAuthGuard)
  async setLevel(
    @Param('userId') userId: string,
    @Body() body: { level: 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'expert' }
  ) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (!body.level) throw new BadRequestException('Level is required');
    
    const validLevels = ['novice', 'beginner', 'intermediate', 'advanced', 'expert'];
    if (!validLevels.includes(body.level)) {
      throw new BadRequestException(`Level must be one of: ${validLevels.join(', ')}`);
    }
    
    try {
      const newLevel = await this.authService.setUserLevel(userId, body.level);
      return { level: newLevel };
    } catch (error) {
      throw new NotFoundException(error.message);
    }
  }
  
  // PUT /auth/credits/:userId
  @Put('credits/:userId')
  @UseGuards(JwtAuthGuard)
  async updateCredits(
    @Param('userId') userId: string,
    @Body() body: { credits: number }
  ) {
    if (!userId) throw new BadRequestException('User ID is required');
    if (body.credits === undefined) throw new BadRequestException('Credits amount is required');
    
    try {
      const updatedCredits = await this.authService.incrementCredits(userId, body.credits);
      return { credits: updatedCredits };
    } catch (error) {
      throw new NotFoundException(error.message);
    }
  }

  @Get('search')
  @UseGuards(JwtAuthGuard)
  async searchUsers(@Query('username') username: string, @Query('limit') limit?: number) {
    if (!username) {
      throw new BadRequestException('Username query parameter is required');
    }
    
    const limitValue = limit ? parseInt(limit.toString(), 10) : 10;
    
    return this.authService.searchUsersByUsername(username, limitValue);
  }

  @Delete('user/:userId')
  @UseGuards(JwtAuthGuard)
  async deleteUser(@Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    try {
      const result = await this.authService.deleteUserDataAsync(userId);
      return result;
    } catch (error) {
      if (error.message.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      throw new BadRequestException('Failed to initiate user deletion');
    }
  }
}
