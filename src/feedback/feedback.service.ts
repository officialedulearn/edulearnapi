import { Injectable, NotFoundException } from '@nestjs/common';
import db from '../../drizzle';
import { feedback } from '../../lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { CreateFeedbackDto, UpdateFeedbackStatusDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
  async createFeedback(createFeedbackDto: CreateFeedbackDto) {
    const newFeedback = await db
      .insert(feedback)
      .values({
        userId: createFeedbackDto.userId,
        content: createFeedbackDto.content,
        category: createFeedbackDto.category,
      })
      .returning();

    return newFeedback[0];
  }

  async getAllFeedback() {
    const allFeedback = await db
      .select()
      .from(feedback)
      .orderBy(desc(feedback.createdAt));

    return allFeedback;
  }

  async getUserFeedback(userId: string) {
    const userFeedback = await db
      .select()
      .from(feedback)
      .where(eq(feedback.userId, userId))
      .orderBy(desc(feedback.createdAt));

    return userFeedback;
  }

  async getFeedbackById(id: string) {
    const feedbackItem = await db
      .select()
      .from(feedback)
      .where(eq(feedback.id, id));

    if (!feedbackItem || feedbackItem.length === 0) {
      throw new NotFoundException(`Feedback with id ${id} not found`);
    }

    return feedbackItem[0];
  }

  async updateFeedbackStatus(
    id: string,
    updateStatusDto: UpdateFeedbackStatusDto,
    reviewerId: string,
  ) {
    const existingFeedback = await this.getFeedbackById(id);

    const updatedFeedback = await db
      .update(feedback)
      .set({
        status: updateStatusDto.status,
        reviewedAt: new Date(),
        reviewedBy: reviewerId,
      })
      .where(eq(feedback.id, id))
      .returning();

    return updatedFeedback[0];
  }
}



