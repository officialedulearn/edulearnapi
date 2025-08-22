import {
    Body,
    Controller,
    Post,
    UseGuards
} from '@nestjs/common';
import { Message } from 'lib/db/schema';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AiService } from './ai.service';

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
}
