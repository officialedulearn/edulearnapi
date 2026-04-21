import {
  Controller,
  Get,
  Post,
  Delete,
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
import { PublishQuizDto } from './dto/publish-quiz.dto';
import { SubmitPublicQuizDto } from './dto/submit-public-quiz.dto';
import { QuizScheduleService } from './quiz-schedule.service';
import { UpsertQuizScheduleDto } from './dto/upsert-quiz-schedule.dto';

@Controller('quizzes')
export class QuizzesController {
  constructor(
    private readonly quizzesService: QuizzesService,
    private readonly quizScheduleService: QuizScheduleService,
  ) {}

  @Post('schedule')
  @UseGuards(JwtAuthGuard)
  async upsertSchedule(@Request() req, @Body() dto: UpsertQuizScheduleDto) {
    const userId = await getDatabaseUserId(req.user);
    return this.quizScheduleService.upsertForUser(userId, dto);
  }

  @Get('schedule')
  @UseGuards(JwtAuthGuard)
  async getSchedule(@Request() req) {
    const userId = await getDatabaseUserId(req.user);
    return this.quizScheduleService.getForUser(userId);
  }

  @Delete('schedule')
  @UseGuards(JwtAuthGuard)
  async deleteSchedule(@Request() req) {
    const userId = await getDatabaseUserId(req.user);
    await this.quizScheduleService.deleteForUser(userId);
    return { ok: true };
  }

  @Post('public')
  @UseGuards(JwtAuthGuard)
  async publish(@Request() req, @Body() dto: PublishQuizDto) {
    const userId = await getDatabaseUserId(req.user);
    return this.quizzesService.publish(userId, dto);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  async listMine(
    @Request() req,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const userId = await getDatabaseUserId(req.user);
    const limitNum = limit ? parseInt(limit, 10) : 20;
    const offsetNum = offset ? parseInt(offset, 10) : 0;
    return this.quizzesService.findMine(userId, limitNum, offsetNum);
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

  @Post('public/:id/participate')
  @UseGuards(JwtAuthGuard)
  async startParticipation(@Request() req, @Param('id') id: string) {
    const userId = await getDatabaseUserId(req.user);
    return this.quizzesService.startParticipation(id, userId);
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
}
