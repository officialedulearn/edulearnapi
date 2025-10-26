import {
    Body,
    Controller,
    Post,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    InternalServerErrorException,
    HttpException,
    HttpStatus,
    Request
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiResponse, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Message } from 'lib/db/schema';
import { FlexibleAuthGuard } from 'src/auth/guards/flexible-auth.guard';
import { AiService } from './ai.service';
import { verifyUserAuthorization } from '../common/helpers/authorization.helper';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { File } from 'multer';

@ApiTags('ai')
@ApiSecurity('marketplace-key')
@Controller('ai')
@UseGuards(FlexibleAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('title')
  @ApiOperation({ summary: 'Generate a title from a message' })
  @ApiResponse({ status: 200, description: 'Returns generated title' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getTitle(@Body() messageDto: Message) {
    try {
      return await this.aiService.generateTitleFromMessage(messageDto);
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
    description: 'Send a conversation and get an AI-generated response. This is the main endpoint for chat interactions.'
  })
  @ApiResponse({ status: 200, description: 'Returns AI-generated response' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateMessages(
    @Request() req,
    @Body()
    messageDto: {
      messages: Array<Message>;
      chatId: string;
      userId: string;
    },
  ) {
    await verifyUserAuthorization(req.user, messageDto.userId, 'generating AI response');
    
    try {
      return await this.aiService.generateResponse(messageDto);
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
  @ApiOperation({ summary: 'Generate a quiz based on chat conversation' })
  @ApiResponse({ status: 200, description: 'Returns generated quiz' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateQuiz(@Request() req, @Body() quizDto: { chatId: string; userId: string }) {
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

  @Post('suggestions')
  @ApiOperation({ summary: 'Generate learning topic suggestions' })
  @ApiResponse({ status: 200, description: 'Returns topic suggestions' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async generateSuggestions(@Request() req, @Body() suggestionsDto: { userId: string }) {
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
  @ApiOperation({ summary: 'Transcribe audio file to text' })
  @ApiConsumes('multipart/form-data')
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
}
