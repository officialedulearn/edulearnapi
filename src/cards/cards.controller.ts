import { Controller, Get, Res, Query } from '@nestjs/common';
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
    res.send(png);
  }
}
