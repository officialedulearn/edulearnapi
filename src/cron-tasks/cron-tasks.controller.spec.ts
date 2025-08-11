import { Test, TestingModule } from '@nestjs/testing';
import { CronTasksController } from './cron-tasks.controller';

describe('CronTasksController', () => {
  let controller: CronTasksController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CronTasksController],
    }).compile();

    controller = module.get<CronTasksController>(CronTasksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
