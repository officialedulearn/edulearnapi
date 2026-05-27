import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RoadmapService } from './roadmap.service';

@Injectable()
export class RoadmapSubStepBackfillService {
  private readonly logger = new Logger(RoadmapSubStepBackfillService.name);

  constructor(private readonly roadmapService: RoadmapService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async backfillMissingSubSteps() {
    const result = await this.roadmapService.backfillMissingRoadmapSubSteps();

    if (result.processed > 0) {
      this.logger.log(
        `Backfilled roadmap sub-steps: processed=${result.processed} created=${result.created}`,
      );
    }
  }
}
