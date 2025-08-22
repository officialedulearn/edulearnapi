import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    Param,
    NotFoundException,
    UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { Message } from '../../lib/db/schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
    constructor(private readonly chatService: ChatService) {}

    @Post()
    async createChat(@Body() createChatDto: { title: string; userId: string }) {
        return await this.chatService.createChat(createChatDto);
    }

    @Get('user/:userId')
    async getAllChatsForUser(@Param('userId') userId: string) {
        return await this.chatService.getAllChatsForUser(userId);
    }

    @Get(':chatId')
    async getChatById(@Param('chatId') chatId: string) {
        const chat = await this.chatService.getChatById(chatId);
        if (!chat) {
            throw new NotFoundException(`Chat with id ${chatId} not found`);
        }
        return chat;
    }

    @Delete(':chatId')
    async deleteChat(@Param('chatId') chatId: string) {
        return await this.chatService.deleteChat(chatId);
    }

    @Post('messages')
    async saveMessages(@Body() saveMessagesDto: { messages: Array<Message> }) {
        return await this.chatService.saveMessages(saveMessagesDto);
    }

    @Get(':chatId/messages')
    async getMessagesInChat(@Param('chatId') chatId: string) {
        return await this.chatService.getMessagesInChat(chatId);
    }

    @Delete(':chatId/messages')
    async deleteMessagesInChat(@Param('chatId') chatId: string) {
        return await this.chatService.deleteMessagesInChat(chatId);
    }
}
