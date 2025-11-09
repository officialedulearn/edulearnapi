import { Global, Module } from '@nestjs/common';
import { ExpoPushService } from './services/expo-push.service';

@Global()
@Module({
  providers: [ExpoPushService],
  exports: [ExpoPushService],
})
export class CommonModule {}



