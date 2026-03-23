import {
    Body,
    Controller,
    Post,
    Get,
    Delete,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    InternalServerErrorException,
    HttpException,
    HttpStatus,
    Request,
    Sse,
    MessageEvent,
    Query,
    Param,
    NotFoundException,
    ForbiddenException,
    DefaultValuePipe,
    ParseIntPipe,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiTags, ApiOperation, ApiSecurity, ApiResponse, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { FlexibleAuthGuard } from 'src/auth/guards/flexible-auth.guard';
import { MarketplaceApiKeyGuard } from 'src/auth/guards/marketplace-api-key.guard';
import { AiService } from './ai.service';
import { verifyUserAuthorization } from '../common/helpers/authorization.helper';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { File } from 'multer';
import { 
  GenerateMessagesDto, 
  GenerateTitleDto, 
  GenerateQuizDto, 
  GenerateSuggestionsDto,
  GenerateFlashcardsDto,
  MarketplaceStreamDto 
} from './dto/ai.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@ApiTags('ai')
@ApiSecurity('marketplace-key')
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('title')
  @ApiOperation({ 
    summary: 'Generate a title from a message',
    description: 'Generates a concise title based on the content of a message. Useful for naming chat conversations.'
  })
  @ApiBody({ 
    type: GenerateTitleDto,
    description: 'Message object to generate title from',
    examples: {
      example1: {
        summary: 'Text message example',
        value: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          chatId: '123e4567-e89b-12d3-a456-426614174000',
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Can you explain quantum computing?'
            }
          ],
          createdAt: '2024-01-15T10:30:00.000Z'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Returns generated title' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getTitle(@Body() messageDto: GenerateTitleDto) {
    try {
      return await this.aiService.generateTitleFromMessage(messageDto as any);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }

      throw new InternalServerErrorException('An unexpected error occurred while generating the title');
    }
  }

  @Post('message')
  @ApiOperation({ 
    summary: 'Generate AI response to messages',
    description: 'Send a conversation and get an AI-generated response. This is the main endpoint for chat interactions. Supports both text and multimodal content (images).'
  })
  @ApiBody({ 
    type: GenerateMessagesDto,
    description: 'Conversation data including messages array, chatId, and userId',
    examples: {
      textOnly: {
        summary: 'Text-only conversation',
        value: {
          messages: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              chatId: '123e4567-e89b-12d3-a456-426614174000',
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'What is machine learning?'
                }
              ],
              createdAt: '2024-01-15T10:30:00.000Z'
            },
            {
              id: '550e8400-e29b-41d4-a716-446655440001',
              chatId: '123e4567-e89b-12d3-a456-426614174000',
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: 'Machine learning is a subset of artificial intelligence...'
                }
              ],
              createdAt: '2024-01-15T10:30:15.000Z'
            },
            {
              id: '550e8400-e29b-41d4-a716-446655440002',
              chatId: '123e4567-e89b-12d3-a456-426614174000',
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Can you give me an example?'
                }
              ],
              createdAt: '2024-01-15T10:31:00.000Z'
            }
          ],
          chatId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fbc97-4bed-5078-9f07-9141ba07c9f3'
        }
      },
      withImage: {
        summary: 'Multimodal conversation with image',
        value: {
          messages: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              chatId: '123e4567-e89b-12d3-a456-426614174000',
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'What do you see in this image?'
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: 'https://example.com/image.jpg'
                  }
                }
              ],
              createdAt: '2024-01-15T10:30:00.000Z'
            }
          ],
          chatId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fbc97-4bed-5078-9f07-9141ba07c9f3'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Returns AI-generated response' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateMessages(
    @Request() req,
    @Body() messageDto: GenerateMessagesDto,
  ) {
    await verifyUserAuthorization(req.user, messageDto.userId, 'generating AI response');
    
    try {
      return await this.aiService.generateResponse(messageDto as any);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      
      throw new InternalServerErrorException('An unexpected error occurred while generating the response');
    }
  }

  @Post('quiz')
  @ApiOperation({ 
    summary: 'Generate a quiz based on chat conversation',
    description: 'Creates a quiz with multiple-choice questions based on the content of a chat conversation. Useful for testing comprehension and learning.'
  })
  @ApiBody({ 
    type: GenerateQuizDto,
    description: 'Chat and user information to generate quiz from',
    examples: {
      example1: {
        summary: 'Generate quiz from chat',
        value: {
          chatId: '123e4567-e89b-12d3-a456-426614174000',
          userId: '987fbc97-4bed-5078-9f07-9141ba07c9f3'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Returns generated quiz' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateQuiz(@Request() req, @Body() quizDto: GenerateQuizDto) {
    await verifyUserAuthorization(req.user, quizDto.userId, 'generating quiz');
    
    try {
      return await this.aiService.generateQuiz(quizDto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      
      throw new InternalServerErrorException('An unexpected error occurred while generating the quiz');
    }
  }

  @Post('flashcards/generate')
  @ApiOperation({
    summary: 'Generate flashcards from a topic',
    description:
      'Creates a new flashcard deck with AI-generated cards. Charges 0.5 credits per card.',
  })
  @ApiBody({ type: GenerateFlashcardsDto })
  @ApiResponse({ status: 200, description: 'Saved deck and cards' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden (e.g. insufficient credits)' })
  async generateFlashcards(
    @Request() req,
    @Body() dto: GenerateFlashcardsDto,
  ) {
    await verifyUserAuthorization(req.user, dto.userId, 'generating flashcards');

    try {
      return await this.aiService.generateFlashcards(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }

      throw new InternalServerErrorException(
        'An unexpected error occurred while generating flashcards',
      );
    }
  }

  @Get('flashcards')
  @ApiOperation({ summary: 'List flashcard decks for a user' })
  @ApiResponse({ status: 200, description: 'List of decks' })
  async listFlashcards(
    @Request() req,
    @Query('userId') userId: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    await verifyUserAuthorization(req.user, userId, 'listing flashcards');
    return this.aiService.listFlashcardDecks(userId, limit, offset);
  }

  @Get('flashcards/:deckId')
  @ApiOperation({ summary: 'Get a flashcard deck with cards' })
  @ApiResponse({ status: 200, description: 'Deck and cards' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async getFlashcardDeck(
    @Request() req,
    @Param('deckId') deckId: string,
    @Query('userId') userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    await verifyUserAuthorization(req.user, userId, 'fetching flashcard deck');
    try {
      return await this.aiService.getFlashcardDeckWithCards(userId, deckId);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      throw new InternalServerErrorException(
        'An unexpected error occurred while fetching flashcards',
      );
    }
  }

  @Delete('flashcards/:deckId')
  @ApiOperation({ summary: 'Delete a flashcard deck' })
  @ApiResponse({ status: 200, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async deleteFlashcardDeck(
    @Request() req,
    @Param('deckId') deckId: string,
    @Query('userId') userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    await verifyUserAuthorization(req.user, userId, 'deleting flashcard deck');
    try {
      await this.aiService.deleteFlashcardDeck(userId, deckId);
      return { ok: true };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      throw new InternalServerErrorException(
        'An unexpected error occurred while deleting flashcards',
      );
    }
  }

  @Post('suggestions')
  @ApiOperation({ 
    summary: 'Generate learning topic suggestions',
    description: 'Generates personalized learning topic suggestions for a user based on their activity and interests.'
  })
  @ApiBody({ 
    type: GenerateSuggestionsDto,
    description: 'User information to generate suggestions for',
    examples: {
      example1: {
        summary: 'Get suggestions for user',
        value: {
          userId: '987fbc97-4bed-5078-9f07-9141ba07c9f3'
        }
      }
    }
  })
  @ApiResponse({ status: 200, description: 'Returns topic suggestions' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateSuggestions(@Request() req, @Body() suggestionsDto: GenerateSuggestionsDto) {
    await verifyUserAuthorization(req.user, suggestionsDto.userId, 'generating suggestions');
    
    try {
      return await this.aiService.generateSuggestions(suggestionsDto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      
      throw new InternalServerErrorException('An unexpected error occurred while generating suggestions');
    }
  }

  @Post('transcribe-audio')
  @ApiOperation({ 
    summary: 'Transcribe audio file to text',
    description: 'Converts an audio file to text using speech-to-text AI. Supports multiple audio formats including MP3, WAV, M4A, AAC, WebM, OGG, and more. Maximum file size: 10MB.'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Audio file to transcribe',
    schema: {
      type: 'object',
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
          description: 'Audio file (MP3, WAV, M4A, AAC, WebM, OGG, 3GP, AMR)',
        },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Returns transcribed text' })
  @ApiResponse({ status: 400, description: 'Invalid file or bad request' })
  @UseInterceptors(FileInterceptor('audio', {
    storage: diskStorage({
      destination: './uploads/audio',
      filename: (req, file, cb) => {
        const randomName = Array(32).fill(null).map(() => (Math.round(Math.random() * 16)).toString(16)).join('');
        cb(null, `${randomName}${extname(file.originalname)}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      const allowedMimes = [
        'audio/mpeg',     // MP3 files
        'audio/mp3',      // Alternative MP3 MIME type (some clients use this)
        'audio/wav',      // WAV files
        'audio/wave',     // Alternative WAV MIME type
        'audio/x-wav',    // Another WAV variant
        'audio/m4a',      // M4A files
        'audio/mp4',      // MP4 audio
        'audio/aac',      // AAC files
        'audio/x-m4a',    // M4A variant
        'audio/webm',     // WebM audio
        'audio/ogg',      // OGG audio
        'audio/3gpp',     // 3GP audio
        'audio/amr'       // AMR audio
      ];
      
      console.log('Received file with MIME type:', file.mimetype);
      
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        console.error('Rejected file with MIME type:', file.mimetype);
        cb(new BadRequestException(`Invalid file type: ${file.mimetype}. Only audio files are allowed.`), false);
      }
    },
    limits: {
      fileSize: 10 * 1024 * 1024,
    },
  }))
  async transcribeAudio(
    @UploadedFile() file: File
  ) {
    if (!file) {
      throw new BadRequestException('No audio file provided');
    }

    try {
      return await this.aiService.transcribeAudioOnly({
        file,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      
      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }
      
      throw new InternalServerErrorException('An unexpected error occurred while transcribing audio');
    }
  }

  @Sse('marketplace-stream')
  @UseGuards(MarketplaceApiKeyGuard)
  @ApiOperation({ 
    summary: 'Stream marketplace agent responses (SSE)',
    description: 'Real-time streaming endpoint for marketplace AI agent. Returns tokens as they are generated via Server-Sent Events. Connect using EventSource. Requires x-marketplace-key header passed via query param. Supports conversation history via chatId.'
  })
  @ApiSecurity('marketplace-key')
  @ApiResponse({ 
    status: 200, 
    description: 'SSE stream of AI tokens. Each event contains: { token: string }. Use EventSource to connect.' 
  })
  @ApiResponse({ status: 401, description: 'Invalid or missing marketplace API key' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  marketplaceStream(
    @Query('message') message: string,
    @Query('chatId') chatId: string,
    @Query('apiKey') apiKey: string
  ): Observable<MessageEvent> {
    if (!message) {
      throw new BadRequestException('Message query parameter is required');
    }
    
    if (!chatId) {
      chatId = 'marketplace-chat-' + Date.now();
    }

    const messages = [
      {
        id: 'msg-' + Date.now(),
        chatId: chatId,
        role: 'user' as const,
        content: [{ type: 'text', text: message }],
        createdAt: new Date()
      }
    ];

    return this.aiService.generateMarketplaceStream({ messages, chatId } as any);
  }

  @Post('message-stream/init')
  @ApiOperation({ 
    summary: 'Initialize streaming session',
    description: 'Creates a streaming session and returns a stream ID that can be used to connect to the SSE endpoint. This two-step approach handles large message arrays better than direct SSE connections.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns stream ID',
    schema: {
      type: 'object',
      properties: {
        streamId: { type: 'string', description: 'Unique stream session ID' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async initializeStream(
    @Request() req,
    @Body() messageDto: GenerateMessagesDto,
  ): Promise<{ streamId: string }> {
    await verifyUserAuthorization(req.user, messageDto.userId, 'streaming AI response');
    
    const streamId = `stream-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    if (!global['streamRequests']) {
      global['streamRequests'] = {};
    }
    
    global['streamRequests'][streamId] = {
      ...messageDto,
      createdAt: Date.now(),
    };
    
    setTimeout(() => {
      if (global['streamRequests'] && global['streamRequests'][streamId]) {
        delete global['streamRequests'][streamId];
      }
    }, 5 * 60 * 1000);
    
    return { streamId };
  }

  @Sse('message-stream/:streamId')
  @ApiOperation({ 
    summary: 'Connect to streaming session (SSE)',
    description: 'Server-Sent Events endpoint for real-time AI response streaming. Use the streamId from the initialization endpoint. Returns tokens as they are generated. Each event contains: { token: string, type: string }'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'SSE stream of AI tokens. Events: "message" for tokens, "done" when complete.' 
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Stream session not found or expired' })
  messageStream(
    @Request() req,
    @Param('streamId') streamId: string,
  ): Observable<MessageEvent> {
    const streamRequest = global['streamRequests']?.[streamId];
    
    if (!streamRequest) {
      throw new NotFoundException('Stream session not found or expired. Please initialize a new stream.');
    }
    
    if (!streamRequest.userId) {
      throw new ForbiddenException('Invalid stream session');
    }
    
    if (global['streamRequests']) {
      delete global['streamRequests'][streamId];
    }
    
    return this.aiService.generateResponseStream({
      messages: streamRequest.messages,
      chatId: streamRequest.chatId,
      userId: streamRequest.userId,
    });
  }
}
