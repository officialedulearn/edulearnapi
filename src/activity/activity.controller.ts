import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ActivityService } from './activity.service';
import { FlexibleAuthGuard } from '../auth/guards/flexible-auth.guard';
import {
  verifyUserAuthorization,
  verifyUserViewAuthorization,
} from '../common/helpers/authorization.helper';
import { SubmitQuizDto } from './dto/submit-quiz.dto';

@Controller('activity')
@UseGuards(FlexibleAuthGuard)
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Post()
  async createActivity(
    @Request() req,
    @Body()
    createActivityDto: {
      userId: string;
      type: 'quiz' | 'chat' | 'streak';
      title: string;
      xpEarned: number;
    },
  ) {
    if (
      !createActivityDto.userId ||
      !createActivityDto.type ||
      createActivityDto.xpEarned === undefined
    ) {
      throw new BadRequestException(
        'User ID, type, and XP earned are required',
      );
    }

    const maxXP = createActivityDto.type === 'streak' ? 1 : 10;
    if (createActivityDto.xpEarned > maxXP || createActivityDto.xpEarned < 0) {
      throw new BadRequestException(
        `XP must be between 0 and ${maxXP} for ${createActivityDto.type} activities`,
      );
    }

    await verifyUserAuthorization(
      req.user,
      createActivityDto.userId,
      'creating activity',
    );

    try {
      return await this.activityService.createActivity(createActivityDto);
    } catch (error) {
      throw new BadRequestException(
        'Failed to create activity: ' + error.message,
      );
    }
  }

  @Post('submit-quiz')
  async submitQuiz(@Request() req, @Body() submitQuizDto: SubmitQuizDto) {
    if (
      !submitQuizDto.userId ||
      !submitQuizDto.answers ||
      !Array.isArray(submitQuizDto.answers)
    ) {
      throw new BadRequestException('User ID and answers array are required');
    }

    if (submitQuizDto.answers.length === 0) {
      throw new BadRequestException('At least one answer is required');
    }

    await verifyUserAuthorization(
      req.user,
      submitQuizDto.userId,
      'submitting quiz',
    );

    try {
      return await this.activityService.submitQuiz(submitQuizDto);
    } catch (error) {
      throw new BadRequestException('Failed to submit quiz: ' + error.message);
    }
  }

  @Get('user/:userId')
  async getActivitiesByUser(
    @Request() req,
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('includeTotal') includeTotal?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    await verifyUserViewAuthorization(req.user, userId);

    const shouldPaginate = limit !== undefined || page !== undefined;

    let parsedLimit = 10;
    let parsedPage = 1;

    if (shouldPaginate) {
      parsedLimit =
        limit === undefined ? 10 : Number.parseInt(String(limit), 10);
      parsedPage = page === undefined ? 1 : Number.parseInt(String(page), 10);

      if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
        throw new BadRequestException('limit must be an integer between 1 and 100');
      }

      if (!Number.isInteger(parsedPage) || parsedPage < 1) {
        throw new BadRequestException('page must be an integer greater than or equal to 1');
      }
    }

    try {
      if (shouldPaginate) {
        return await this.activityService.getActivitiesByUser(userId, {
          limit: parsedLimit,
          page: parsedPage,
          includeTotal: includeTotal === 'true',
        });
      }

      return await this.activityService.getActivitiesByUser(userId);
    } catch (error) {
      throw new BadRequestException(
        'Failed to fetch activities: ' + error.message,
      );
    }
  }

  @Get('user/:userId/quiz')
  async getQuizActivitiesByUser(
    @Request() req,
    @Param('userId') userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    await verifyUserViewAuthorization(req.user, userId);

    try {
      return await this.activityService.getQuizActivitiesByUser(userId);
    } catch (error) {
      throw new BadRequestException(
        'Failed to fetch quiz activities: ' + error.message,
      );
    }
  }

  @Get('user/:userId/xp/quiz')
  async getQuizXpTotal(@Request() req, @Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    await verifyUserViewAuthorization(req.user, userId);

    try {
      const total = await this.activityService.getTotalXpByActivityType(
        userId,
        'quiz',
      );
      return { userId, type: 'quiz', totalXp: total };
    } catch (error) {
      throw new BadRequestException(
        'Failed to fetch quiz XP total: ' + error.message,
      );
    }
  }

  @Get('user/:userId/xp')
  async getXpByType(
    @Request() req,
    @Param('userId') userId: string,
    @Query('type') type: 'quiz' | 'chat' | 'streak',
  ) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    if (!type || !['quiz', 'chat', 'streak'].includes(type)) {
      throw new BadRequestException(
        'Valid type is required (quiz, chat, or streak)',
      );
    }

    await verifyUserViewAuthorization(req.user, userId);

    try {
      const total = await this.activityService.getTotalXpByActivityType(
        userId,
        type,
      );
      return { userId, type, totalXp: total };
    } catch (error) {
      throw new BadRequestException(
        `Failed to fetch ${type} XP total: ` + error.message,
      );
    }
  }

  @Get('user/:userId/details')
  async getUserWithActivities(@Request() req, @Param('userId') userId: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    await verifyUserViewAuthorization(req.user, userId);

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
      throw new BadRequestException(
        'Failed to fetch user with activities: ' + error.message,
      );
    }
  }

  @Get()
  async getAllActivities() {
    try {
      return await this.activityService.getAllActivities();
    } catch (error) {
      throw new BadRequestException(
        'Failed to fetch all activities: ' + error.message,
      );
    }
  }
}
