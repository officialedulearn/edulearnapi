import { Module } from '@nestjs/common';
import { RoadmapController } from './roadmap.controller';
import { RoadmapService } from './roadmap.service';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RoadmapController],
  providers: [RoadmapService],
  exports: [RoadmapService]
})
export class RoadmapModule {}
