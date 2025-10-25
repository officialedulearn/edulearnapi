import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    Param,
    NotFoundException,
    UseGuards,
    Request,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { Message } from '../../lib/db/schema';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { verifyUserAuthorization } from '../common/helpers/authorization.helper';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
    constructor(private readonly chatService: ChatService) {}

    @Post()
    async createChat(@Request() req, @Body() createChatDto: { title: string; userId: string }) {
        await verifyUserAuthorization(req.user, createChatDto.userId, 'creating chat');
        return await this.chatService.createChat(createChatDto);
    }

    @Get('user/:userId')
    async getAllChatsForUser(@Request() req, @Param('userId') userId: string) {
        await verifyUserAuthorization(req.user, userId, 'viewing chats');
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
    async deleteChat(@Request() req, @Param('chatId') chatId: string) {
        // First get the chat to verify ownership
        const chat = await this.chatService.getChatById(chatId);
        if (!chat) {
            throw new NotFoundException(`Chat with id ${chatId} not found`);
        }
        
        // Verify the authenticated user owns this chat
        await verifyUserAuthorization(req.user, chat.userId, 'deleting chat');
        
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
