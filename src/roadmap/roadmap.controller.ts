import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  NotFoundException,
  Request,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RoadmapService } from './roadmap.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from 'src/ai/ai.service';
import {
  verifyUserAuthorization,
  verifyUserViewAuthorization,
} from '../common/helpers/authorization.helper';

@Controller('roadmap')
@UseGuards(JwtAuthGuard)
export class RoadmapController {
  constructor(
    private readonly roadmapService: RoadmapService,
    private readonly aiService: AiService,
  ) {}

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @Post('generate')
  async generateRoadmap(
    @Request() req,
    @Body() body: { userId: string; topic: string },
  ) {
    const { userId, topic } = body;
    if (!userId || !topic) {
      throw new NotFoundException('User ID and topic are required');
    }
    await verifyUserAuthorization(req.user, userId, 'generating roadmap');
    return await this.roadmapService.generateRoadmap(userId, topic);
  }

  @Get('user/:userId')
  async getUserRoadmaps(@Request() req, @Param('userId') userId: string) {
    await verifyUserViewAuthorization(req.user, userId);
    return await this.roadmapService.getRoadmapsByUserId(userId);
  }



  @Get(':roadmapId')
  async getRoadmapById(@Param('roadmapId') roadmapId: string) {
    const response = await this.roadmapService.getRoadmapWithSteps(roadmapId);
    if (!response) {
      throw new NotFoundException('Roadmap not found');
    }
    return response;
  }

  @Get(':roadmapId/steps')
  async getRoadmapSteps(@Param('roadmapId') roadmapId: string) {
    return await this.roadmapService.getRoadmapSteps(roadmapId);
  }

  @Post('step/:stepId/start')
  async startRoadmapStep(
    @Request() req,
    @Param('stepId') stepId: string,
    @Body() body: { userId: string; mode?: 'sync' | 'background' },
  ) {
    const { userId, mode } = body;
    if (!userId) {
      throw new NotFoundException('User ID is required');
    }
    await verifyUserAuthorization(req.user, userId, 'starting roadmap step');
    if (mode === 'background') {
      return await this.roadmapService.startRoadmapStepInBackground(
        stepId,
        userId,
      );
    }
    return await this.roadmapService.startRoadmapStep(
      stepId,
      userId,
      this.aiService,
    );
  }

  @Post(':roadmapId/delete')
  async deleteRoadmap(@Param('roadmapId') roadmapId: string) {
    return await this.roadmapService.deleteRoadmap(roadmapId);
  }

  @Post('step/:stepId/edit')
  async editRoadmapStep(
    @Request() req,
    @Param('stepId') stepId: string,
    @Body()
    body: {
      userId: string;
      prompt: string;
      title: string;
      description: string;
      time: number;
    },
  ) {
    const { userId, prompt, title, description, time } = body;
    if (!userId) {
      throw new NotFoundException('User ID is required');
    }
    await verifyUserAuthorization(req.user, userId, 'editing roadmap step');
    return await this.roadmapService.editRoadmapStep(
      stepId,
      prompt,
      title,
      description,
      time,
    );
  }
}
