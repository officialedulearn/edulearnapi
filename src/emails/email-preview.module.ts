import { Module } from '@nestjs/common';
import { EmailPreviewController } from './email-preview.controller';

@Module({
  controllers: [EmailPreviewController],
})
export class EmailPreviewModule {}
