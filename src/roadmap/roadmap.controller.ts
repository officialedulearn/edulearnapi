import { Controller, Post, Get, Body, Param, UseGuards, NotFoundException, Request } from '@nestjs/common';
import { RoadmapService } from './roadmap.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AiService } from 'src/ai/ai.service';
import { verifyUserAuthorization, verifyUserViewAuthorization } from '../common/helpers/authorization.helper';

@Controller('roadmap')
@UseGuards(JwtAuthGuard)
export class RoadmapController {
    constructor(
        private readonly roadmapService: RoadmapService,
        private readonly aiService: AiService,
    ) {}

    @Post('generate')
    async generateRoadmap(
        @Request() req,
        @Body() body: { userId: string; topic: string }
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
        const roadmap = await this.roadmapService.getRoadmapById(roadmapId);
        if (!roadmap) {
            throw new NotFoundException('Roadmap not found');
        }
        const steps = await this.roadmapService.getRoadmapSteps(roadmapId);
        console.log('Steps from DB:', steps.map(s => ({ id: s.id, title: s.title, done: s.done, doneType: typeof s.done })));
        return { roadmap, steps };
    }

    @Get(':roadmapId/steps')
    async getRoadmapSteps(@Param('roadmapId') roadmapId: string) {
        return await this.roadmapService.getRoadmapSteps(roadmapId);
    }

    @Post('step/:stepId/start')
    async startRoadmapStep(
        @Request() req,
        @Param('stepId') stepId: string,
        @Body() body: { userId: string }
    ) {
        const { userId } = body;
        if (!userId) {
            throw new NotFoundException('User ID is required');
        }
        await verifyUserAuthorization(req.user, userId, 'starting roadmap step');
        return await this.roadmapService.startRoadmapStep(stepId, userId, this.aiService);
    }
}
