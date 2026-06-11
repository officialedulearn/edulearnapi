import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import {
  CreateFeedbackDto,
  UpdateFeedbackStatusDto,
} from './dto/create-feedback.dto';
import { AdminApiKeyGuard } from '../auth/guards/admin-api-key.guard';
import { FlexibleAuthGuard } from '../auth/guards/flexible-auth.guard';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  async createFeedback(@Body() createFeedbackDto: CreateFeedbackDto) {
    return await this.feedbackService.createFeedback(createFeedbackDto);
  }

  @Get()
  @UseGuards(AdminApiKeyGuard)
  async getAllFeedback() {
    return await this.feedbackService.getAllFeedback();
  }

  @Get('user/:userId')
  @UseGuards(FlexibleAuthGuard)
  async getUserFeedback(@Request() req, @Param('userId') userId: string) {
    return await this.feedbackService.getUserFeedback(userId);
  }

  @Put(':id/status')
  @UseGuards(AdminApiKeyGuard)
  async updateFeedbackStatus(
    @Request() req,
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateFeedbackStatusDto,
  ) {
    const reviewerId = req.user?.sub || 'admin';
    return await this.feedbackService.updateFeedbackStatus(
      id,
      updateStatusDto,
      reviewerId,
    );
  }
}
