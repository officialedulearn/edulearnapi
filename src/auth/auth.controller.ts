import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { signUpDetails } from 'types/auth';
import { UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from './guards/api-key.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  async signUp(@Body() data: signUpDetails) {
    const result = await this.authService.createUser(data);
    if (result instanceof Error) {
      throw new BadRequestException(result.message);
    }
    return result;
  }

  // GET /auth/email/:email
  @Get('email/:email')
  async getUserByEmail(@Param('email') email: string) {
    const user = await this.authService.getUserByEmail(email);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  // GET /auth/id/:id
  @Get('id/:id')
  async getUserById(@Param('id') id: string) {
    const user = await this.authService.getUserById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }
  
  @UseGuards(ApiKeyGuard)
  @Put('edit')
  async editUser(@Body() body: { name: string; email: string }) {
    const { name, email } = body;

    if (!name || !email) {
      throw new BadRequestException('Name and email are required');
    }

    const updatedUser = await this.authService.editUser({ name, email });

    if (!updatedUser) {
      throw new BadRequestException('User not found or update failed');
    }

    return updatedUser;
  }
  // PUT /auth/address?email=someone@email.com&address=solanaWallet
  @Put('address')
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
  async incrementReferral(@Query('code') code: string) {
    if (!code) throw new BadRequestException('Referral code is required');
    const name = await this.authService.incrementReferralCount(code);
    if (!name) throw new NotFoundException('Referral code not found');
    return { referrer: name };
  }
}
