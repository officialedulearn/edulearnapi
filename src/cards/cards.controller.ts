import { Controller, Get, Res, Query, Param } from '@nestjs/common';
import { CardsService } from './cards.service';
import { Response } from 'express';

@Controller('cards')
export class CardsController {
  constructor(private readonly cardsService: CardsService) {}
  
  @Get('og')
  async og(
    @Query('title') title: string,
    @Query('subtitle') subtitle: string,
    @Query('mascot') mascot: string,
    @Query('theme') theme: 'light' | 'dark',
    @Res() res: Response,
  ) {
    const png = await this.cardsService.generateOg({ title, subtitle, mascotUrl: mascot, theme });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(png);
  }

  @Get('streak/:userId')
  async streak(
    @Param('userId') userId: string,
    @Query('theme') theme: 'light' | 'dark',
    @Res() res: Response,
  ) {
    const png = await this.cardsService.generateStreakCard({ userId, theme });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(png);
  }

  @Get('earnings/:userId')
  async earnings(
    @Param('userId') userId: string,
    @Query('theme') theme: 'light' | 'dark',
    @Res() res: Response,
  ) {
    const png = await this.cardsService.generateEarningsCard({ userId, theme });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(png);
  }

  @Get('level/:userId')
  async level(
    @Param('userId') userId: string,
    @Query('theme') theme: 'light' | 'dark',
    @Res() res: Response,
  ) {
    const png = await this.cardsService.generateLevelCard({ userId, theme });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(png);
  }
}
