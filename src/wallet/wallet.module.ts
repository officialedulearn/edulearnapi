import { forwardRef, Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { AuthModule } from 'src/auth/auth.module';
import { TwitterModule } from 'src/twitter/twitter.module';
import { ResendModule } from 'src/resend/resend.module';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => TwitterModule), forwardRef(() => ResendModule)],
  providers: [WalletService],
  controllers: [WalletController],
  exports: [WalletService]
})
export class WalletModule {}
