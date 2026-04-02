import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
  Request,
} from '@nestjs/common';
import { RewardsService } from './rewards.service';
import { FlexibleAuthGuard } from '../auth/guards/flexible-auth.guard';
import { AdminApiKeyGuard } from '../auth/guards/admin-api-key.guard';
import {
  verifyUserAuthorization,
  verifyUserViewAuthorization,
} from '../common/helpers/authorization.helper';

@Controller('rewards')
@UseGuards(FlexibleAuthGuard)
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  @Post('claim')
  async claimReward(
    @Request() req,
    @Body() data: { userId: string; rewardId: string },
  ) {
    if (!data.userId || !data.rewardId) {
      throw new BadRequestException('User ID and reward ID are required');
    }

    await verifyUserAuthorization(req.user, data.userId, 'claiming reward');

    try {
      const signature = await this.rewardsService.claimReward(
        data.userId,
        data.rewardId,
      );
      return {
        success: true,
        signature,
        message: 'Reward claimed successfully',
      };
    } catch (error) {
      console.error('Error claiming reward:', error.message);
      const errorMessage = error?.message || 'Failed to claim reward';
      throw new BadRequestException(errorMessage);
    }
  }

  @Post('claim/admin')
  async claimRewardAdmin(
    @Request() req,
    @Body() data: { userId: string; rewardId: string },
  ) {
    console.log('📥 Received /rewards/claim/admin request:', {
      userId: data.userId,
      rewardId: data.rewardId,
      userEmail: req.user?.email,
      userRole: req.user?.role,
      timestamp: new Date().toISOString(),
    });

    if (!data.userId || !data.rewardId) {
      throw new BadRequestException('User ID and reward ID are required');
    }

    await verifyUserAuthorization(req.user, data.userId, 'claiming reward');

    try {
      const signature = await this.rewardsService.claimRewardAdmin(
        data.userId,
        data.rewardId,
      );
      console.log('✅ Badge claimed successfully (admin-paid):', {
        userId: data.userId,
        rewardId: data.rewardId,
      });
      return {
        success: true,
        signature,
        message: 'Badge claimed successfully',
      };
    } catch (error) {
      console.error('❌ Error claiming badge (admin-paid):', error.message);
      const errorMessage = error?.message || 'Failed to claim badge';
      throw new BadRequestException(errorMessage);
    }
  }
  @Post()
  @UseGuards(AdminApiKeyGuard)
  async createReward(
    @Body()
    data: {
      type: 'certificate' | 'points';
      title: string;
      description: string;
      imageUrl?: string;
      ipfs?: string;
    },
  ) {
    if (!data.type || !data.title || !data.description) {
      throw new BadRequestException(
        'Type, title, and description are required',
      );
    }

    try {
      return await this.rewardsService.createReward(data);
    } catch (error) {
      console.error('Error creating reward:', error.message);
      const errorMessage = error?.message || 'Failed to create reward';
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
  async awardRewardToUser(@Body() data: { userId: string; rewardId: string }) {
    if (!data.userId || !data.rewardId) {
      throw new BadRequestException('User ID and reward ID are required');
    }

    try {
      return await this.rewardsService.awardRewardToUser(
        data.userId,
        data.rewardId,
      );
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
  async getUserCertificateCount(
    @Request() req,
    @Param('userId') userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    await verifyUserViewAuthorization(req.user, userId);

    try {
      const count = await this.rewardsService.getUserCertificateCount(userId);
      return { count };
    } catch (error) {
      console.error('Error fetching certificate count:', error.message);
      const errorMessage =
        error?.message || 'Failed to fetch user certificate count';
      throw new BadRequestException(errorMessage);
    }
  }

  @Delete(':id')
  @UseGuards(AdminApiKeyGuard)
  async deleteReward(@Param('id') id: string) {
    if (!id) {
      throw new BadRequestException('Reward ID is required');
    }

    try {
      const result = await this.rewardsService.deleteReward(id);
      if (!result) {
        throw new NotFoundException(`Reward with id ${id} not found`);
      }
      return { success: true, message: 'Reward deleted successfully' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      console.error('Error deleting reward:', error.message);
      const errorMessage = error?.message || 'Failed to delete reward';
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
      const errorMessage =
        error?.message || 'Failed to fetch reward recipients';
      throw new BadRequestException(errorMessage);
    }
  }

  @Get('claim-status/:userId/:rewardId')
  async getClaimStatus(
    @Request() req,
    @Param('userId') userId: string,
    @Param('rewardId') rewardId: string,
  ) {
    if (!userId || !rewardId) {
      throw new BadRequestException('User ID and Reward ID are required');
    }

    await verifyUserViewAuthorization(req.user, userId);

    try {
      return await this.rewardsService.getClaimStatus(userId, rewardId);
    } catch (error) {
      console.error('Error fetching claim status:', error.message);
      const errorMessage = error?.message || 'Failed to fetch claim status';
      throw new BadRequestException(errorMessage);
    }
  }
}
