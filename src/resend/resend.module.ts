import { Module, Global } from '@nestjs/common';
import { ResendService } from './resend.service';
import { Resend } from 'resend';

@Global()
@Module({
  providers: [
    {
      provide: Resend,
      useFactory: () => {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          throw new Error('RESEND_API_KEY is not set');
        }
        return new Resend(apiKey);
      },
    },
    ResendService,
  ],
  exports: [ResendService],
})
export class ResendModule {}
