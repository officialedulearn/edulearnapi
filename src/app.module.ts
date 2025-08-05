import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AiModule } from './ai/ai.module';
import { ChatModule } from './chat/chat.module';
import { RewardsModule } from './rewards/rewards.module';
import { ActivityModule } from './activity/activity.module';
import { ConfigModule } from '@nestjs/config';
import { WalletService } from './wallet/wallet.service';
import { WalletController } from './wallet/wallet.controller';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    AuthModule,
    AiModule,
    ChatModule,
    RewardsModule,
    ActivityModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    WalletModule,
  ],
  controllers: [AppController],
  providers: [AppService, WalletService],
})
export class AppModule {}
