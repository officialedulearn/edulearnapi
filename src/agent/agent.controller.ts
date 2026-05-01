import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { AgentService } from './agent.service';
import { FlexibleAuthGuard } from '../auth/guards/flexible-auth.guard';
import { getDatabaseUserId } from '../common/helpers/authorization.helper';
import { parseProfileImageMultipart } from '../common/helpers/multipart-image.helper';

@Throttle({ default: { limit: 25, ttl: 60_000 } })
@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post()
  async createAgent(
    @Body()
    body: {
      userId: string;
      name: string;
      purpose: string;
      profile_picture_url: string;
    },
  ) {
    try {
      return await this.agentService.createAgent(body);
    } catch (e) {
      if (e instanceof Error && e.message === 'User already has an agent') {
        throw new ConflictException('User already has an agent');
      }
      throw e;
    }
  }

  @Get('user/:userId')
  getAgentsByUserId(@Param('userId') userId: string) {
    return this.agentService.getAgentsByUserId(userId);
  }

  @Post(':agentId/profile-picture/upload')
  @UseGuards(FlexibleAuthGuard)
  async uploadAgentProfilePicture(
    @Req() req: FastifyRequest,
    @Param('agentId') agentId: string,
  ) {
    const userId = await getDatabaseUserId(req['user']);
    const agentRecord = await this.agentService.getAgentById(agentId);
    if (agentRecord.userId !== userId) {
      throw new ForbiddenException('You do not own this agent');
    }
    const { buffer } = await parseProfileImageMultipart(req);
    return this.agentService.uploadAgentProfilePicture(agentId, buffer);
  }

  @Get(':agentId')
  async getAgentById(@Param('agentId') agentId: string) {
    try {
      return await this.agentService.getAgentById(agentId);
    } catch (e) {
      if (e instanceof Error && e.message === 'Agent not found') {
        throw new NotFoundException('Agent not found');
      }
      throw e;
    }
  }
}
