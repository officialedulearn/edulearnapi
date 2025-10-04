import { Controller, Post, Get, Body, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { RoadmapService } from './roadmap.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from 'src/ai/ai.service';

@Controller('roadmap')
@UseGuards(JwtAuthGuard)
export class RoadmapController {
    constructor(
        private readonly roadmapService: RoadmapService,
        private readonly aiService: AiService,
    ) {}

    @Post('generate')
    async generateRoadmap(
        @Body() body: { userId: string; topic: string }
    ) {
        const { userId, topic } = body;
        if (!userId || !topic) {
            throw new NotFoundException('User ID and topic are required');
        }
        return await this.roadmapService.generateRoadmap(userId, topic);
    }

    @Get('user/:userId')
    async getUserRoadmaps(@Param('userId') userId: string) {
        return await this.roadmapService.getRoadmapsByUserId(userId);
    }

    @Get(':roadmapId')
    async getRoadmapById(@Param('roadmapId') roadmapId: string) {
        const roadmap = await this.roadmapService.getRoadmapById(roadmapId);
        if (!roadmap) {
            throw new NotFoundException('Roadmap not found');
        }
        const steps = await this.roadmapService.getRoadmapSteps(roadmapId);
        return { roadmap, steps };
    }

    @Get(':roadmapId/steps')
    async getRoadmapSteps(@Param('roadmapId') roadmapId: string) {
        return await this.roadmapService.getRoadmapSteps(roadmapId);
    }

    @Post('step/:stepId/start')
    async startRoadmapStep(
        @Param('stepId') stepId: string,
        @Body() body: { userId: string }
    ) {
        const { userId } = body;
        if (!userId) {
            throw new NotFoundException('User ID is required');
        }
        return await this.roadmapService.startRoadmapStep(stepId, userId, this.aiService);
    }
}
