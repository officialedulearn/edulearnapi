import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { ChatModule } from './chat/chat.module';
import { RewardsModule } from './rewards/rewards.module';
import { ActivityModule } from './activity/activity.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    AuthModule,
    AiModule,
    ChatModule,
    RewardsModule,
    ActivityModule,
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigModule available globally
      envFilePath: '.env', // Specifies the path to your .env file
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
