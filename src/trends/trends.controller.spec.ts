import { Test, TestingModule } from '@nestjs/testing';
import { TrendsController } from './trends.controller';
import { TrendsService } from './trends.service';

describe('TrendsController', () => {
  let controller: TrendsController;
  let trendsService: { getHubTrends: jest.Mock };

  beforeEach(async () => {
    trendsService = { getHubTrends: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrendsController],
      providers: [{ provide: TrendsService, useValue: trendsService }],
    }).compile();

    controller = module.get<TrendsController>(TrendsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes parsed limit to the trends service', async () => {
    const response = { users: [], quizzes: [] };
    trendsService.getHubTrends.mockResolvedValue(response);

    await expect(controller.getHubTrends('12')).resolves.toBe(response);
    expect(trendsService.getHubTrends).toHaveBeenCalledWith(12);
  });
});
