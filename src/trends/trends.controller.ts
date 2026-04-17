import { Controller, Get } from '@nestjs/common';
import { TrendsService } from './trends.service';
import { Trends } from '../../lib/db/schema';

@Controller('trends')
export class TrendsController {
  constructor(private readonly trendsService: TrendsService) {
  }

  // @Get('fetch')
  // async fetchWeeklyTrendsFromPerplexity(): Promise<Trends[]> {
  //   // return this.trendsService.fetchWeeklyTrendsFromPerplexity();
  // }
}
