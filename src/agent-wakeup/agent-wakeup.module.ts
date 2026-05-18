import { Module } from '@nestjs/common';
import { AiModule } from 'src/ai/ai.module';
import { ChatModule } from 'src/chat/chat.module';
import { AgentWakeupBullmqService } from './agent-wakeup-bullmq.service';
import { AgentWakeupDecisionService } from './agent-wakeup-decision.service';
import { AgentWakeupProcessorService } from './agent-wakeup-processor.service';
import { AgentWakeupService } from './agent-wakeup.service';

@Module({
  imports: [AiModule, ChatModule],
  providers: [
    AgentWakeupBullmqService,
    AgentWakeupDecisionService,
    AgentWakeupProcessorService,
    AgentWakeupService,
  ],
  exports: [AgentWakeupService],
})
export class AgentWakeupModule {}
