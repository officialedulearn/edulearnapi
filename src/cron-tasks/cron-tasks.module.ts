import { forwardRef, Module } from '@nestjs/common';
import { CronTasksService } from './cron-tasks.service';
import { CronTasksController } from './cron-tasks.controller';
import { AuthModule } from 'src/auth/auth.module';
import { WalletModule } from 'src/wallet/wallet.module';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => WalletModule)],
  providers: [CronTasksService],
  controllers: [CronTasksController],
  exports: [CronTasksService]
})
export class CronTasksModule {}