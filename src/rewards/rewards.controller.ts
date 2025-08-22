import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('rewards')
@UseGuards(JwtAuthGuard)
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}
  
  @Post('claim')
  async claimReward(
    @Body() data: { userId: string; rewardId: string }
  ) {
    if (!data.userId || !data.rewardId) {
      throw new BadRequestException('User ID and reward ID are required');
    }
    
    try {
      return await this.rewardsService.claimReward(data.userId, data.rewardId);
    } catch (error) {
      throw new BadRequestException('Failed to claim reward: ' + error.message);
    }
  }

  @Post()
  async createReward(@Body() data: {
    type: 'certificate' | 'points'
    title: string;
    description: string;
    imageUrl?: string;
  }) {
    if (!data.type || !data.title || !data.description) {
      throw new BadRequestException('Type, title, and description are required');
    }
    
    try {
      return await this.rewardsService.createReward(data);
    } catch (error) {
      throw new BadRequestException('Failed to create reward: ' + error.message);
    }
  }

  @Get()
  async getAllRewards() {
    try {
      return await this.rewardsService.getAllRewards();
    } catch (error) {
      throw new BadRequestException('Failed to fetch rewards: ' + error.message);
    }
  }

  @Get(':id')
  async getRewardById(@Param('id') id: string) {
    try {
      const reward = await this.rewardsService.getRewardById(id);
      if (!reward) {
        throw new NotFoundException(`Reward with id ${id} not found`);
      }
      return reward;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch reward: ' + error.message);
    }
  }

  @Put(':id')
  async updateReward(
    @Param('id') id: string,
    @Body() data: {
      type?: 'certificate' | 'points';
      title?: string;
      description?: string;
      imageUrl?: string;
    }
  ) {
    try {
      const updatedReward = await this.rewardsService.updateReward(id, data);
      if (!updatedReward) {
        throw new NotFoundException(`Reward with id ${id} not found`);
      }
      return updatedReward;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to update reward: ' + error.message);
    }
  }

  @Delete(':id')
  async deleteReward(@Param('id') id: string) {
    try {
      const deleted = await this.rewardsService.deleteReward(id);
      if (!deleted) {
        throw new NotFoundException(`Reward with id ${id} not found`);
      }
      return { success: true, message: 'Reward deleted successfully' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to delete reward: ' + error.message);
    }
  }

  @Post('award')
  async awardRewardToUser(
    @Body() data: { userId: string; rewardId: string }
  ) {
    if (!data.userId || !data.rewardId) {
      throw new BadRequestException('User ID and reward ID are required');
    }
    
    try {
      return await this.rewardsService.awardRewardToUser(data.userId, data.rewardId);
    } catch (error) {
      throw new BadRequestException('Failed to award reward: ' + error.message);
    }
  }

  @Get('user/:userId')
  async getUserRewards(@Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    try {
      return await this.rewardsService.getUserRewards(userId);
    } catch (error) {
      throw new BadRequestException('Failed to fetch user rewards: ' + error.message);
    }
  }

  @Delete('user')
  async removeRewardFromUser(
    @Query('userId') userId: string,
    @Query('rewardId') rewardId: string
  ) {
    if (!userId || !rewardId) {
      throw new BadRequestException('User ID and reward ID are required');
    }
    
    try {
      const removed = await this.rewardsService.removeRewardFromUser(userId, rewardId);
      if (!removed) {
        throw new NotFoundException('User-reward relationship not found');
      }
      return { success: true, message: 'Reward removed from user successfully' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to remove reward from user: ' + error.message);
    }
  }

  @Get('user/:userId/certificate-count')
  async getUserCertificateCount(@Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    try {
      const count = await this.rewardsService.getUserCertificateCount(userId);
      return { count };
    } catch (error) {
      throw new BadRequestException('Failed to fetch user certificate count: ' + error.message);
    }
  }

  @Get('recipients/:rewardId')
  async getUsersWithReward(@Param('rewardId') rewardId: string) {
    if (!rewardId) {
      throw new BadRequestException('Reward ID is required');
    }
    
    try {
      return await this.rewardsService.getUsersWithReward(rewardId);
    } catch (error) {
      throw new BadRequestException('Failed to fetch reward recipients: ' + error.message);
    }
  }
}