import { Module, forwardRef } from '@nestjs/common';
import { ReminderBullmqService } from './reminder-bullmq.service';
import { ReminderProcessorService } from './reminder-processor.service';
import { RemindersService } from './reminders.service';
import { ReminderDecisionService } from './reminder-decision.service';
import { AiModule } from 'src/ai/ai.module';
import { ResendModule } from 'src/resend/resend.module';

@Module({
  imports: [forwardRef(() => AiModule), ResendModule],
  providers: [
    ReminderBullmqService,
    ReminderProcessorService,
    ReminderDecisionService,
    RemindersService,
  ],
  exports: [RemindersService],
})
export class RemindersModule {}

