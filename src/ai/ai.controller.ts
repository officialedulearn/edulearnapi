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
import { FileInterceptor } from '@nestjs/platform-express';
import { FlexibleAuthGuard } from 'src/auth/guards/flexible-auth.guard';
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
} from './dto/ai.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('title')
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

      throw new InternalServerErrorException(
        'An unexpected error occurred while generating the title',
      );
    }
  }

  @Post('message')
  async generateMessages(
    @Request() req,
    @Body() messageDto: GenerateMessagesDto,
  ) {
    await verifyUserAuthorization(
      req.user,
      messageDto.userId,
      'generating AI response',
    );

    try {
      return await this.aiService.generateResponse(messageDto as any);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }

      throw new InternalServerErrorException(
        'An unexpected error occurred while generating the response',
      );
    }
  }

  @Post('quiz')
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

      throw new InternalServerErrorException(
        'An unexpected error occurred while generating the quiz',
      );
    }
  }

  @Post('flashcards/generate')
  async generateFlashcards(@Request() req, @Body() dto: GenerateFlashcardsDto) {
    await verifyUserAuthorization(
      req.user,
      dto.userId,
      'generating flashcards',
    );

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
  async generateSuggestions(
    @Request() req,
    @Body() suggestionsDto: GenerateSuggestionsDto,
  ) {
    await verifyUserAuthorization(
      req.user,
      suggestionsDto.userId,
      'generating suggestions',
    );

    try {
      return await this.aiService.generateSuggestions(suggestionsDto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (error instanceof Error) {
        throw new BadRequestException(error.message);
      }

      throw new InternalServerErrorException(
        'An unexpected error occurred while generating suggestions',
      );
    }
  }

  @Post('transcribe-audio')
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: diskStorage({
        destination: './uploads/audio',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          'audio/mpeg',
          'audio/mp3',
          'audio/wav',
          'audio/wave',
          'audio/x-wav',
          'audio/m4a',
          'audio/mp4',
          'audio/aac', 
          'audio/x-m4a',
          'audio/webm',
          'audio/ogg',
          'audio/3gpp',
          'audio/amr',
        ];

        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              `Invalid file type: ${file.mimetype}. Only audio files are allowed.`,
            ),
            false,
          );
        }
      },
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async transcribeAudio(@UploadedFile() file: File) {
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

      throw new InternalServerErrorException(
        'An unexpected error occurred while transcribing audio',
      );
    }
  }

  @Post('message-stream/init')
  async initializeStream(
    @Request() req,
    @Body() messageDto: GenerateMessagesDto,
  ): Promise<{ streamId: string }> {
    await verifyUserAuthorization(
      req.user,
      messageDto.userId,
      'streaming AI response',
    );

    const streamId = `stream-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    if (!global['streamRequests']) {
      global['streamRequests'] = {};
    }

    global['streamRequests'][streamId] = {
      ...messageDto,
      createdAt: Date.now(),
    };

    setTimeout(
      () => {
        if (global['streamRequests'] && global['streamRequests'][streamId]) {
          delete global['streamRequests'][streamId];
        }
      },
      5 * 60 * 1000,
    );

    return { streamId };
  }

  @Sse('message-stream/:streamId')
  messageStream(
    @Request() req,
    @Param('streamId') streamId: string,
  ): Observable<MessageEvent> {
    const streamRequest = global['streamRequests']?.[streamId];

    if (!streamRequest) {
      throw new NotFoundException(
        'Stream session not found or expired. Please initialize a new stream.',
      );
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
