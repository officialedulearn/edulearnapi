import {
    Body,
    Controller,
    Post,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Message } from 'lib/db/schema';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { File } from 'multer';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('title')
  async getTitle(@Body() messageDto: Message) {
    return await this.aiService.generateTitleFromMessage(messageDto);
  }

  @Post('message')
  async generateMessages(
    @Body()
    messageDto: {
      messages: Array<Message>;
      chatId: string;
      userId: string;
    },
  ) {
    return await this.aiService.generateResponse(messageDto);
  }

  @Post('quiz')
  async generateQuiz(@Body() quizDto: { chatId: string; userId: string }) {
    return await this.aiService.generateQuiz(quizDto);
  }

  @Post('suggestions')
  async generateSuggestions(@Body() suggestionsDto: { userId: string }) {
    return await this.aiService.generateSuggestions(suggestionsDto);
  }

  @Post('transcribe-audio')
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

    return await this.aiService.transcribeAudioOnly({
      file,
    });
  }
}
