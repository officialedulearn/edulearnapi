import {
  Controller,
  Get,
  Post,
  Query,
  Res,
  Body,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { MonthlyLeaderboardService } from './monthly-leaderboard.service';
import { AdminApiKeyGuard } from '../auth/guards/admin-api-key.guard';

@Controller('monthly-leaderboard')
export class MonthlyLeaderboardController {
  constructor(
    private readonly monthlyLeaderboardService: MonthlyLeaderboardService,
  ) {}

  @Get('preview')
  async preview(
    @Query('year') yearStr: string,
    @Query('month') monthStr: string,
    @Query('mock') mockStr: string,
    @Query('theme') theme: 'light' | 'dark',
    @Res() res: Response,
  ) {
    const now = new Date();
    const year = yearStr ? parseInt(yearStr, 10) : now.getFullYear();
    const month = monthStr ? parseInt(monthStr, 10) : now.getMonth() + 1;
    const mock = mockStr === '1' || mockStr === 'true';

    const png = await this.monthlyLeaderboardService.buildPreviewPng({
      year,
      month,
      theme,
      mock,
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  }

  @Post('post')
  @UseGuards(AdminApiKeyGuard)
  async postTest(
    @Body()
    body: {
      year?: number;
      month?: number;
    },
  ) {
    const now = new Date();
    const year = body?.year ?? now.getFullYear();
    const month = body?.month ?? now.getMonth() + 1;
    await this.monthlyLeaderboardService.postMonthToX(year, month);
    return { ok: true, year, month };
  }
}
