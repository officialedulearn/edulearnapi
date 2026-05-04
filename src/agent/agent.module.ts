import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { CloudinaryModule } from 'src/common/cloudinary/cloudinary.module';
import { RemindersModule } from 'src/reminders/reminders.module';

@Module({
  imports: [CloudinaryModule, RemindersModule],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
