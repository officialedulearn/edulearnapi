import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { AgentService } from './agent.service';

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
