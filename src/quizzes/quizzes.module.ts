import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { QuizGenerationService } from './quiz-generation.service';
import { QuizSchedulerService } from './quiz-scheduler.service';
import { ActivityModule } from '../activity/activity.module';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ActivityModule,
    forwardRef(() => AiModule),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [QuizzesController],
  providers: [QuizzesService, QuizGenerationService, QuizSchedulerService],
  exports: [QuizGenerationService],
})
export class QuizzesModule {}
