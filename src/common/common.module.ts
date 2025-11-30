import { Global, Module } from '@nestjs/common';
import { ExpoPushService } from './services/expo-push.service';
import {NotificationsService} from "./services/notifications.service"

@Global()
@Module({
  providers: [ExpoPushService, NotificationsService],
  exports: [ExpoPushService, NotificationsService],
})
export class CommonModule {}
