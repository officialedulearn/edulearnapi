import { Module, forwardRef } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { QuizGenerationService } from './quiz-generation.service';
import { ActivityModule } from '../activity/activity.module';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ActivityModule,
    forwardRef(() => AiModule),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [QuizzesController],
  providers: [QuizzesService, QuizGenerationService],
  exports: [QuizGenerationService],
})
export class QuizzesModule {}
