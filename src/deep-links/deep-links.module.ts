import { Module } from '@nestjs/common';
import { DeepLinksController } from './deep-links.controller';
import { DeepLinksService } from './deep-links.service';

@Module({
  controllers: [DeepLinksController],
  providers: [DeepLinksService],
})
export class DeepLinksModule {}
