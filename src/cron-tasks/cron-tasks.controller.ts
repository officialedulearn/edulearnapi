import { Controller, Post, UseGuards } from '@nestjs/common';
import { CronTasksService } from './cron-tasks.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@Controller('cron-tasks')
@UseGuards(ApiKeyGuard)
export class CronTasksController {}
