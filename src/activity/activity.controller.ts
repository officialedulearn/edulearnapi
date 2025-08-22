import { Controller, Get, Post, Body, Param, Query, BadRequestException, NotFoundException, UseGuards } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@Controller('activity')
@UseGuards(ApiKeyGuard)
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Post()
  async createActivity(@Body() createActivityDto: { 
    userId: string; 
    type: 'quiz' | 'chat' | 'streak';
    title: string;
    xpEarned: number;
  }) {
    if (!createActivityDto.userId || !createActivityDto.type || createActivityDto.xpEarned === undefined) {
      throw new BadRequestException('User ID, type, and XP earned are required');
    }
    
    try {
      return await this.activityService.createActivity(createActivityDto);
    } catch (error) {
      throw new BadRequestException('Failed to create activity: ' + error.message);
    }
  }

  @Get('user/:userId')
  async getActivitiesByUser(@Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    try {
      return await this.activityService.getActivitiesByUser(userId);
    } catch (error) {
      throw new BadRequestException('Failed to fetch activities: ' + error.message);
    }
  }

  @Get('user/:userId/quiz')
  async getQuizActivitiesByUser(@Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    try {
      return await this.activityService.getQuizActivitiesByUser(userId);
    } catch (error) {
      throw new BadRequestException('Failed to fetch quiz activities: ' + error.message);
    }
  }

  @Get('user/:userId/xp/quiz')
  async getQuizXpTotal(@Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    try {
      const total = await this.activityService.getTotalXpByActivityType(userId, 'quiz');
      return { userId, type: 'quiz', totalXp: total };
    } catch (error) {
      throw new BadRequestException('Failed to fetch quiz XP total: ' + error.message);
    }
  }

  @Get('user/:userId/xp')
  async getXpByType(
    @Param('userId') userId: string,
    @Query('type') type: 'quiz' | 'chat' | 'streak'
  ) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    if (!type || !['quiz', 'chat', 'streak'].includes(type)) {
      throw new BadRequestException('Valid type is required (quiz, chat, or streak)');
    }
    
    try {
      const total = await this.activityService.getTotalXpByActivityType(userId, type);
      return { userId, type, totalXp: total };
    } catch (error) {
      throw new BadRequestException(`Failed to fetch ${type} XP total: ` + error.message);
    }
  }

  @Get('user/:userId/details')
  async getUserWithActivities(@Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }
    
    try {
      const result = await this.activityService.getUserWithActivities(userId);
      if (!result.user) {
        throw new NotFoundException(`User with id ${userId} not found`);
      }
      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch user with activities: ' + error.message);
    }
  }

  @Get()
  async getAllActivities() {
    try {
      return await this.activityService.getAllActivities();
    } catch (error) {
      throw new BadRequestException('Failed to fetch all activities: ' + error.message);
    }
  }
}