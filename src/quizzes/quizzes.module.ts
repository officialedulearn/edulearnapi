import { Module, forwardRef } from '@nestjs/common';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';
import { ActivityModule } from '../activity/activity.module';

@Module({
  imports: [forwardRef(() => ActivityModule)],
  controllers: [QuizzesController],
  providers: [QuizzesService],
  exports: [QuizzesService],
})
export class QuizzesModule {}
