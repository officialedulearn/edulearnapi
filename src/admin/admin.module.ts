import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CommonModule } from '../common/common.module';
import { ResendModule } from '../resend/resend.module';
import { RemindersModule } from '../reminders/reminders.module';

@Module({
  imports: [CommonModule, ResendModule, RemindersModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
