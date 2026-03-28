import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  BadRequestException,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  verifyUserAuthorization,
  getDatabaseUserId,
} from '../common/helpers/authorization.helper';
import { QuizzesService } from './quizzes.service';
import { QuizGenerationService } from './quiz-generation.service';
import { PublishQuizDto } from './dto/publish-quiz.dto';
import { SubmitPublicQuizDto } from './dto/submit-public-quiz.dto';

@Controller('quizzes')
export class QuizzesController {
  constructor(
    private readonly quizzesService: QuizzesService,
    private readonly quizGenerationService: QuizGenerationService,
  ) {}

  @Post('public')
  @UseGuards(JwtAuthGuard)
  async publish(@Request() req, @Body() dto: PublishQuizDto) {
    const userId = await getDatabaseUserId(req.user);
    return this.quizzesService.publish(userId, dto);
  }

  @Get('public')
  async list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sort') sort?: 'recent' | 'popular',
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    const sortVal = sort === 'popular' ? 'popular' : 'recent';
    return this.quizzesService.findAll(limitNum, offsetNum, sortVal);
  }

  @Get('public/:id')
  async getOne(@Param('id') id: string) {
    return this.quizzesService.findOne(id);
  }

  @Post('public/:id/attempt')
  @UseGuards(JwtAuthGuard)
  async submitAttempt(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: SubmitPublicQuizDto,
  ) {
    if (!dto.userId || !dto.answers?.length) {
      throw new BadRequestException('userId and answers required');
    }
    await verifyUserAuthorization(req.user, dto.userId, 'submitting attempt');
    return this.quizzesService.submitAttempt(id, dto.userId, dto);
  }

  /**
   * Generate a quiz from user's recent learning history
   * Creates a notification and returns quiz ID
   * POST /quizzes/generate
   */
  @Post('generate')
  @UseGuards(JwtAuthGuard)
  async generateQuizFromLearning(
    @Request() req,
    @Query('daysBack') daysBack?: string,
  ) {
    const userId = await getDatabaseUserId(req.user);
    const days = daysBack ? parseInt(daysBack, 10) : 3;
    return this.quizGenerationService.generateQuizFromRecentLearning(
      userId,
      days,
    );
  }

  /**
   * Get user's generated quizzes
   * GET /quizzes/generated
   */
  @Get('generated')
  @UseGuards(JwtAuthGuard)
  async getUserGeneratedQuizzes(
    @Request() req,
    @Query('limit') limit?: string,
  ) {
    const userId = await getDatabaseUserId(req.user);
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.quizGenerationService.getUserGeneratedQuizzes(
      userId,
      limitNum,
    );
  }

  /**
   * Share quiz (increment view count for shareable links)
   * Public endpoint - no auth required
   * GET /quizzes/public/:id/share
   */
  @Get('public/:id/share')
  async shareQuiz(@Param('id') id: string) {
    // This endpoint increments view count for quiz sharing analytics
    // Same as findOne but used for tracking shared links
    return this.quizzesService.findOne(id);
  }
}
