import { Test, TestingModule } from '@nestjs/testing';

jest.mock('./roadmap.service', () => ({
  RoadmapService: class RoadmapService {},
}));

jest.mock('src/ai/ai.service', () => ({
  AiService: class AiService {},
}));

import { RoadmapController } from './roadmap.controller';
import { RoadmapService } from './roadmap.service';
import { AiService } from 'src/ai/ai.service';

describe('RoadmapController', () => {
  let controller: RoadmapController;
  const roadmapService = {
    startRoadmapStep: jest.fn(),
    startRoadmapStepInBackground: jest.fn(),
  };
  const aiService = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoadmapController],
      providers: [
        { provide: RoadmapService, useValue: roadmapService },
        { provide: AiService, useValue: aiService },
      ],
    }).compile();

    controller = module.get<RoadmapController>(RoadmapController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('keeps sync mode as the default for old clients', async () => {
    roadmapService.startRoadmapStep.mockResolvedValue({ aiResponse: {} });

    await controller.startRoadmapStep({ user: { id: 'user-1' } }, 'step-1', {
      userId: 'user-1',
    });

    expect(roadmapService.startRoadmapStep).toHaveBeenCalledWith(
      'step-1',
      'user-1',
      aiService,
    );
    expect(roadmapService.startRoadmapStepInBackground).not.toHaveBeenCalled();
  });

  it('uses background mode only when explicitly requested', async () => {
    roadmapService.startRoadmapStepInBackground.mockResolvedValue({
      status: 'queued',
    });

    await controller.startRoadmapStep({ user: { id: 'user-1' } }, 'step-1', {
      userId: 'user-1',
      mode: 'background',
    });

    expect(roadmapService.startRoadmapStepInBackground).toHaveBeenCalledWith(
      'step-1',
      'user-1',
    );
    expect(roadmapService.startRoadmapStep).not.toHaveBeenCalled();
  });
});
