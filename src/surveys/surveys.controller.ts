import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import * as jwt from 'jsonwebtoken';
import { AdminApiKeyGuard } from '../auth/guards/admin-api-key.guard';
import {
  CreateSurveyDto,
  SubmitSurveyResponseDto,
  UpdateSurveyDto,
} from './dto/survey.dto';
import { SurveysService } from './surveys.service';

type JwtPayloadWithSub = jwt.JwtPayload & { sub?: string };

@Controller('surveys')
export class SurveysController {
  constructor(private readonly surveysService: SurveysService) {}

  @Get('active')
  async getActiveSurvey() {
    return await this.surveysService.getActiveSurvey();
  }

  @Get('slug/:slug')
  async getSurveyBySlug(@Param('slug') slug: string) {
    return await this.surveysService.getPublicSurveyBySlug(slug);
  }

  @Post(':surveyId/responses')
  async submitSurveyResponse(
    @Param('surveyId') surveyId: string,
    @Body() dto: SubmitSurveyResponseDto,
    @Headers('authorization') authorization: string | undefined,
    @Request() request: FastifyRequest,
  ) {
    const userId = this.getOptionalUserId(authorization);
    return await this.surveysService.submitResponse(surveyId, dto, userId, {
      userAgent: request.headers['user-agent'] ?? null,
    });
  }

  private getOptionalUserId(authorization?: string): string | null {
    const [type, token] = authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) return null;

    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) return null;

    try {
      const payload = jwt.verify(token, jwtSecret) as JwtPayloadWithSub | string;
      if (typeof payload === 'string') return null;
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }
}

@Controller('admin/surveys')
@UseGuards(AdminApiKeyGuard)
export class AdminSurveysController {
  constructor(private readonly surveysService: SurveysService) {}

  @Get()
  async listSurveys() {
    return await this.surveysService.listAdminSurveys();
  }

  @Post()
  async createSurvey(@Body() dto: CreateSurveyDto) {
    return await this.surveysService.createSurvey(dto);
  }

  @Get(':id')
  async getSurvey(@Param('id') id: string) {
    return await this.surveysService.getAdminSurvey(id);
  }

  @Put(':id')
  async updateSurvey(@Param('id') id: string, @Body() dto: UpdateSurveyDto) {
    return await this.surveysService.updateSurvey(id, dto);
  }

  @Post(':id/publish')
  async publishSurvey(@Param('id') id: string) {
    return await this.surveysService.publishSurvey(id);
  }

  @Post(':id/archive')
  async archiveSurvey(@Param('id') id: string) {
    return await this.surveysService.archiveSurvey(id);
  }

  @Get(':id/responses')
  async getSurveyResponses(@Param('id') id: string) {
    return await this.surveysService.getSurveyResponses(id);
  }

  @Post(':id/analysis')
  async getSurveyAnalysis(
    @Param('id') id: string,
    @Query('force') force?: string,
  ) {
    return await this.surveysService.getOrGenerateAnalysis(id, force === 'true');
  }
}
