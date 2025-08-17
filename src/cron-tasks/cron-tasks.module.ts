import { Module } from '@nestjs/common';
import { CronTasksService } from './cron-tasks.service';
import { CronTasksController } from './cron-tasks.controller';
import { AuthModule } from 'src/auth/auth.module';
import { WalletModule } from 'src/wallet/wallet.module';

@Module({
  imports: [AuthModule, WalletModule],
  providers: [CronTasksService],
  controllers: [CronTasksController]
})
export class CronTasksModule {}
