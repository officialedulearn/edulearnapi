import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import {
  AdminSurveysController,
  SurveysController,
} from './surveys.controller';
import { SurveysService } from './surveys.service';

@Module({
  imports: [AiModule],
  controllers: [SurveysController, AdminSurveysController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
