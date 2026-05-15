import { Module } from '@nestjs/common';
import { DeepLinksController } from './deep-links.controller';
import { DeepLinksService } from './deep-links.service';
import { CacheModule } from '@nestjs/cache-manager';
@Module({
  imports: [CacheModule.register()],
  controllers: [DeepLinksController],
  providers: [DeepLinksService],
})
export class DeepLinksModule {}
