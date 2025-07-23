import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ChatModule } from 'src/chat/chat.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [ChatModule, AuthModule],
  controllers: [AiController],
  providers: [AiService]
})
export class AiModule {}
