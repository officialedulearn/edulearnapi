import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
} from '@nestjs/common';
import { UserService } from './user.service';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

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
