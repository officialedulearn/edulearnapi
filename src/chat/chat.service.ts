import { Injectable } from '@nestjs/common';
import { asc, desc, eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import db from '../../drizzle';
import {
  chat,
  message,
  roadmap,
  roadMapStep,
  type Chat,
  type Message,
} from '../../lib/db/schema';

@Injectable()
export class ChatService {
  async createChat({
    title,
    userId,
    chatId,
  }: {
    title: string;
    userId: string;
    chatId?: string;
  }): Promise<Chat> {
    const newChatId = chatId || uuidv4();
    const result = await db
      .insert(chat)
      .values({
        id: newChatId,
        createdAt: new Date(),
        title,
        userId,
      })
      .returning();

    return result[0];
  }

  async getAllChatsForUser(userId: string) {
    return await db
      .select()
      .from(chat)
      .where(and(eq(chat.userId, userId), eq(chat.tested, false)))
      .orderBy(asc(chat.createdAt));
  }

  async markChatAsTested(chatId: string): Promise<Chat | null> {
    const result = await db
      .update(chat)
      .set({ tested: true })
      .where(eq(chat.id, chatId))
      .returning();

    return result.length ? result[0] : null;
  }

  async decrementTestLimit(chatId: string): Promise<Chat | null> {
    const currentChat = await this.getChatById(chatId);
    if (!currentChat) {
      return null;
    }

    const newTestLimit = (currentChat.testLimit || 0) - 1;

    const result = await db
      .update(chat)
      .set({ testLimit: newTestLimit })
      .where(eq(chat.id, chatId))
      .returning();

    return result.length ? result[0] : null;
  }

  async getChatById(chatId: string): Promise<Chat | null> {
    const result = await db.select().from(chat).where(eq(chat.id, chatId));
    return result.length ? result[0] : null;
  }

  async deleteChat(chatId: string) {
    try {
      console.log(`Starting deletion process for chat: ${chatId}`);

      const chatRoadmaps = await db
        .select()
        .from(roadmap)
        .where(eq(roadmap.chatId, chatId));
      console.log(
        `Found ${chatRoadmaps.length} roadmaps linked to chat ${chatId}`,
      );

      for (const chatRoadmap of chatRoadmaps) {
        const deletedSteps = await db
          .delete(roadMapStep)
          .where(eq(roadMapStep.roadmapId, chatRoadmap.id));
        console.log(`Deleted roadmap steps for roadmap ${chatRoadmap.id}`);
      }

      if (chatRoadmaps.length > 0) {
        await db.delete(roadmap).where(eq(roadmap.chatId, chatId));
        console.log(
          `Deleted ${chatRoadmaps.length} roadmaps for chat ${chatId}`,
        );
      }

      await db.delete(message).where(eq(message.chatId, chatId));
      console.log(`Deleted all messages for chat ${chatId}`);

      await db.delete(chat).where(eq(chat.id, chatId));
      console.log(`Deleted chat ${chatId}`);

      return {
        message: 'Chat and all associated data deleted successfully',
        deleted: {
          roadmaps: chatRoadmaps.length,
          chat: true,
          messages: true,
        },
      };
    } catch (error) {
      console.error(`Error deleting chat ${chatId}:`, error);
      throw error;
    }
  }

  async saveMessages({ messages }: { messages: Array<Message> }) {
    if (!messages || !messages.length) {
      throw new Error('No messages to save');
    }
    return await db.insert(message).values(messages);
  }

  async getMessagesInChat(chatId: string) {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, chatId))
      .orderBy(asc(message.createdAt));
  }

  async getLearningContextSnippetForUser(
    userId: string,
    maxChars: number = 4000,
  ): Promise<string> {
    const [latest] = await db
      .select()
      .from(chat)
      .where(eq(chat.userId, userId))
      .orderBy(desc(chat.createdAt))
      .limit(1);
    if (!latest) {
      return '';
    }
    const messages = await this.getMessagesInChat(latest.id);
    const recent = messages.slice(-30);
    const lines = recent.map((m) => {
      const text =
        typeof m.content === 'string'
          ? m.content
          : JSON.stringify(m.content);
      return `${m.role}: ${text}`;
    });
    let text = lines.join('\n\n');
    if (text.length > maxChars) {
      text = text.slice(text.length - maxChars);
    }
    return text;
  }

  async deleteMessagesInChat(chatId: string) {
    await db.delete(message).where(eq(message.chatId, chatId));
    return { message: 'All messages in chat deleted' };
  }
}
