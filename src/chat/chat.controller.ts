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
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { ChatService } from './chat.service';
import { Message } from '../../lib/db/schema';
import { FlexibleAuthGuard } from '../auth/guards/flexible-auth.guard';
import {
  verifyUserAuthorization,
  verifyChatAccess,
} from '../common/helpers/authorization.helper';
import { CreateChatDto } from './dto/create-chat.dto';

@ApiTags('chat')
@ApiSecurity('marketplace-key')
@Controller('chat')
@UseGuards(FlexibleAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new chat session' })
  @ApiBody({ type: CreateChatDto })
  @ApiResponse({ status: 201, description: 'Chat created successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async createChat(@Request() req, @Body() createChatDto: CreateChatDto) {
    await verifyUserAuthorization(
      req.user,
      createChatDto.userId,
      'creating chat',
    );
    return await this.chatService.createChat(createChatDto);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get all chats for a user' })
  @ApiResponse({ status: 200, description: 'Returns all chats for the user' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAllChatsForUser(@Request() req, @Param('userId') userId: string) {
    await verifyUserAuthorization(req.user, userId, 'viewing chats');
    return await this.chatService.getAllChatsForUser(userId);
  }

  @Get(':chatId')
  @ApiOperation({ summary: 'Get a specific chat by ID' })
  @ApiResponse({ status: 200, description: 'Returns the chat' })
  @ApiResponse({ status: 404, description: 'Chat not found' })
  @ApiResponse({ status: 403, description: 'Forbidden - private chat' })
  async getChatById(@Request() req, @Param('chatId') chatId: string) {
    const chat = await this.chatService.getChatById(chatId);
    if (!chat) {
      throw new NotFoundException(`Chat with id ${chatId} not found`);
    }

    await verifyChatAccess(req.user, chat, 'view this chat');

    return chat;
  }

  @Delete(':chatId')
  @ApiOperation({ summary: 'Delete a chat' })
  @ApiResponse({ status: 200, description: 'Chat deleted successfully' })
  @ApiResponse({ status: 404, description: 'Chat not found' })
  async deleteChat(@Request() req, @Param('chatId') chatId: string) {
    const chat = await this.chatService.getChatById(chatId);
    if (!chat) {
      throw new NotFoundException(`Chat with id ${chatId} not found`);
    }

    await verifyUserAuthorization(req.user, chat.userId, 'deleting chat');

    return await this.chatService.deleteChat(chatId);
  }

  @Post('messages')
  @ApiOperation({ summary: 'Save messages to a chat' })
  @ApiResponse({ status: 201, description: 'Messages saved successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - private chat' })
  @ApiResponse({ status: 404, description: 'Chat not found' })
  async saveMessages(
    @Request() req,
    @Body() saveMessagesDto: { messages: Array<Message> },
  ) {
    if (!saveMessagesDto.messages || !saveMessagesDto.messages.length) {
      throw new NotFoundException('No messages provided');
    }

    const chatId = saveMessagesDto.messages[0].chatId;
    const chat = await this.chatService.getChatById(chatId);

    if (!chat) {
      throw new NotFoundException(`Chat with id ${chatId} not found`);
    }

    await verifyChatAccess(req.user, chat, 'save messages to this chat');

    return await this.chatService.saveMessages(saveMessagesDto);
  }

  @Get(':chatId/messages')
  @ApiOperation({ summary: 'Get all messages in a chat' })
  @ApiResponse({ status: 200, description: 'Returns all messages in the chat' })
  @ApiResponse({ status: 403, description: 'Forbidden - private chat' })
  @ApiResponse({ status: 404, description: 'Chat not found' })
  async getMessagesInChat(@Request() req, @Param('chatId') chatId: string) {
    const chat = await this.chatService.getChatById(chatId);

    if (!chat) {
      throw new NotFoundException(`Chat with id ${chatId} not found`);
    }

    await verifyChatAccess(req.user, chat, 'view messages in this chat');

    return await this.chatService.getMessagesInChat(chatId);
  }

  @Delete(':chatId/messages')
  @ApiOperation({ summary: 'Delete all messages in a chat' })
  @ApiResponse({ status: 200, description: 'Messages deleted successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - private chat' })
  @ApiResponse({ status: 404, description: 'Chat not found' })
  async deleteMessagesInChat(@Request() req, @Param('chatId') chatId: string) {
    const chat = await this.chatService.getChatById(chatId);

    if (!chat) {
      throw new NotFoundException(`Chat with id ${chatId} not found`);
    }

    await verifyChatAccess(req.user, chat, 'delete messages in this chat');

    return await this.chatService.deleteMessagesInChat(chatId);
  }
}
