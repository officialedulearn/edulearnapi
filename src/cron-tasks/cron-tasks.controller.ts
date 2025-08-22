import { Controller, Post, UseGuards } from '@nestjs/common';
import { CronTasksService } from './cron-tasks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('cron-tasks')
export class CronTasksController {}
