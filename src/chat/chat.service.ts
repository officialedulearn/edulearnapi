import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import db from '../../drizzle';
import { chat, message, type Message, type Chat } from '../../lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ChatService {
  async createChat({ title, userId }: { title: string; userId: string }) {
    const newChatId = uuidv4();

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
      .where(eq(chat.userId, userId))
      .orderBy(asc(chat.createdAt));
  }

  async getChatById(chatId: string) {
    const result = await db.select().from(chat).where(eq(chat.id, chatId));
    if (!result.length) {
      throw new NotFoundException('Chat not found');
    }
    return result[0];
  }

  async deleteChat(chatId: string) {
    await db.delete(message).where(eq(message.chatId, chatId));

    const result = await db.delete(chat).where(eq(chat.id, chatId));
    return { message: 'Chat and associated messages deleted' };
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
  
  async deleteMessagesInChat(chatId: string) {
    await db.delete(message).where(eq(message.chatId, chatId));
    return { message: 'All messages in chat deleted' };
  }
}
