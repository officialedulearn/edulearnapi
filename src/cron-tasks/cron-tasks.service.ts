import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuthService } from 'src/auth/auth.service';
import db from '../../drizzle';
import { user } from '../../lib/db/schema';


@Injectable()
export class CronTasksService {
    private readonly logger = new Logger(CronTasksService.name);
    constructor(private authService: AuthService) {}

    @Cron('0 0 * * *')
    async handleCreditRenewal() {
      this.logger.log('Running daily credit renewal');
      try {
        const allUsers = await db.select().from(user);
        
        for (const user of allUsers) {
          await this.authService.renewUserCredits(user.id);
        }
        
        this.logger.log('Credit renewal completed');
      } catch (error) {
        this.logger.error('Failed to process credit renewals', error);
      }
    }
}
