import { Injectable, NotFoundException } from '@nestjs/common';
import { Agent, agent } from 'lib/db/schema';
import { v4 as uuid } from 'uuid';
import db from '../../drizzle';
import { eq } from 'drizzle-orm';
import { CloudinaryService } from 'src/common/cloudinary/cloudinary.service';
import { RemindersService } from 'src/reminders/reminders.service';

@Injectable()
export class AgentService {
  constructor(
    private readonly cloudinaryService: CloudinaryService,
    private readonly remindersService: RemindersService,
  ) {}
  async createAgent({
    userId,
    name,
    purpose,
    profile_picture_url,
  }: {
    userId: string;
    name: string;
    purpose: string;
    profile_picture_url: string;
  }): Promise<Agent> {
    const userHasAgent = await db
      .select()
      .from(agent)
      .where(eq(agent.userId, userId));
    if (userHasAgent.length > 0) {
      throw new Error('User already has an agent');
    }
    const newAgentId = uuid();
    const [result] = await db
      .insert(agent)
      .values({
        id: newAgentId,
        userId,
        name,
        purpose,
        profile_picture_url,
      })
      .returning();

    this.remindersService
      .enqueueEvaluation(userId, 'roadmap_updated')
      .catch(() => undefined);
    return result;
  }

  async getAgentById(agentId: string): Promise<Agent> {
    const [result] = await db.select().from(agent).where(eq(agent.id, agentId));
    if (!result) {
      throw new Error('Agent not found');
    }
    return result;
  }

  async getAgentsByUserId(userId: string): Promise<Agent> {
    const [result] = await db
      .select()
      .from(agent)
      .where(eq(agent.userId, userId));
    if (!result) {
      throw new Error('Agent not found');
    }
    return result;
  }

  async uploadAgentProfilePicture(
    agentId: string,
    buffer: Buffer,
  ): Promise<{ profile_picture_url: string }> {
    const url = await this.cloudinaryService.uploadImageBuffer(
      buffer,
      'profiles/agents',
    );
    const updated = await db
      .update(agent)
      .set({ profile_picture_url: url })
      .where(eq(agent.id, agentId))
      .returning();
    if (!updated.length) {
      throw new NotFoundException('Agent not found');
    }
    return { profile_picture_url: url };
  }
}
