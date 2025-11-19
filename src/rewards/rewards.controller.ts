import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, BadRequestException, NotFoundException, Request } from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { FlexibleAuthGuard } from '../auth/guards/flexible-auth.guard';
import { verifyUserAuthorization, verifyUserViewAuthorization } from '../common/helpers/authorization.helper';

@Controller('rewards')
@UseGuards(FlexibleAuthGuard)
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}
  
  @Post('claim')
  async claimReward(
    @Request() req,
    @Body() data: { userId: string; rewardId: string }
  ) {
    if (!data.userId || !data.rewardId) {
      throw new BadRequestException('User ID and reward ID are required');
    }
    
    await verifyUserAuthorization(req.user, data.userId, 'claiming reward');
    
    try {
      const signature = await this.rewardsService.claimReward(data.userId, data.rewardId);
      return { success: true, signature, message: 'Reward claimed successfully' };
    } catch (error) {
      console.error('Error claiming reward:', error.message);
      const errorMessage = error?.message || 'Failed to claim reward';
      throw new BadRequestException(errorMessage);
    }
  }

  @Get()
  async getAllRewards() {
    try {
      return await this.rewardsService.getAllRewards();
    } catch (error) {
      console.error('Error fetching rewards:', error.message);
      const errorMessage = error?.message || 'Failed to fetch rewards';
      throw new BadRequestException(errorMessage);
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
      console.error('Error fetching reward:', error.message);
      const errorMessage = error?.message || 'Failed to fetch reward';
      throw new BadRequestException(errorMessage);
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
      console.error('Error awarding reward:', error.message);
      const errorMessage = error?.message || 'Failed to award reward';
      throw new BadRequestException(errorMessage);
    }
  }

  @Get('user/:userId')
  async getUserRewards(@Request() req, @Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    await verifyUserViewAuthorization(req.user, userId);
    
    try {
      return await this.rewardsService.getUserRewards(userId);
    } catch (error) {
      console.error('Error fetching user rewards:', error.message);
      const errorMessage = error?.message || 'Failed to fetch user rewards';
      throw new BadRequestException(errorMessage);
    }
  }


  @Get('user/:userId/certificate-count')
  async getUserCertificateCount(@Request() req, @Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    await verifyUserViewAuthorization(req.user, userId);
    
    try {
      const count = await this.rewardsService.getUserCertificateCount(userId);
      return { count };
    } catch (error) {
      console.error('Error fetching certificate count:', error.message);
      const errorMessage = error?.message || 'Failed to fetch user certificate count';
      throw new BadRequestException(errorMessage);
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
      console.error('Error fetching reward recipients:', error.message);
      const errorMessage = error?.message || 'Failed to fetch reward recipients';
      throw new BadRequestException(errorMessage);
    }
  }
}