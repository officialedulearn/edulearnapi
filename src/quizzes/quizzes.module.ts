import { Module, forwardRef } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { ActivityModule } from '../activity/activity.module';
import { AiModule } from '../ai/ai.module';
import { ChatModule } from '../chat/chat.module';
import { QuizScheduleBullmqService } from './quiz-schedule-bullmq.service';
import { QuizScheduleProcessorService } from './quiz-schedule-processor.service';
import { QuizScheduleService } from './quiz-schedule.service';
import { RemindersModule } from 'src/reminders/reminders.module';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    forwardRef(() => ActivityModule),
    forwardRef(() => AiModule),
    ChatModule,
    RemindersModule,
    CacheModule.register(),
  ],
  controllers: [QuizzesController],
  providers: [
    QuizzesService,
    QuizScheduleBullmqService,
    QuizScheduleService,
    QuizScheduleProcessorService,
  ],
  exports: [QuizzesService, QuizScheduleService],
})
export class QuizzesModule {}
