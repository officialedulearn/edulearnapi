import {
  Controller,
  Get,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserService } from './user.service';

@Throttle({ default: { limit: 40, ttl: 60_000 } })
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
