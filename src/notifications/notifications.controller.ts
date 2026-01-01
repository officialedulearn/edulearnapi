import {
  Controller,
  Get,
  Delete,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { NotificationsService } from '../common/services/notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getDatabaseUserId } from '../common/helpers/authorization.helper';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getUserNotifications(
    @Request() req,
    @Query('order') order?: 'asc' | 'desc',
  ) {
    const userId = await getDatabaseUserId(req.user);
    const notifications = await this.notificationsService.getUserNotificationsByCreatedAt(
      userId,
      order || 'desc',
    );
    return { notifications };
  }

  @Delete(':notificationId')
  @HttpCode(HttpStatus.OK)
  async deleteNotification(
    @Request() req,
    @Param('notificationId') notificationId: string,
  ) {
    const userId = await getDatabaseUserId(req.user);
    await this.notificationsService.deleteNotification(notificationId, userId);
    return { message: 'Notification deleted successfully' };
  }
}



