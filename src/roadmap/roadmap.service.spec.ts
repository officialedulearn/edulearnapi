import { Test, TestingModule } from '@nestjs/testing';

jest.mock('src/auth/auth.service', () => ({
  AuthService: class AuthService {},
}));

jest.mock('src/chat/chat.service', () => ({
  ChatService: class ChatService {},
}));

jest.mock('src/ai/ai.service', () => ({
  AiService: class AiService {},
}));

jest.mock('src/ai/nft-reward.service', () => ({
  NftRewardService: class NftRewardService {},
}));

jest.mock('src/rewards/rewards.service', () => ({
  RewardsService: class RewardsService {},
}));

jest.mock('src/reminders/reminders.service', () => ({
  RemindersService: class RemindersService {},
}));

jest.mock('src/redis/redis.service', () => ({
  RedisService: class RedisService {},
}));

jest.mock('src/common/services/notifications.service', () => ({
  NotificationsService: class NotificationsService {},
}));

import { RoadmapService } from './roadmap.service';
import { AuthService } from 'src/auth/auth.service';
import { ChatService } from 'src/chat/chat.service';
import { AiService } from 'src/ai/ai.service';
import { NftRewardService } from 'src/ai/nft-reward.service';
import { RewardsService } from 'src/rewards/rewards.service';
import { RemindersService } from 'src/reminders/reminders.service';
import { RedisService } from 'src/redis/redis.service';
import { RoadmapStepStartBullmqService } from './roadmap-step-start-bullmq.service';
import { NotificationsService } from 'src/common/services/notifications.service';

describe('RoadmapService', () => {
  let service: RoadmapService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoadmapService,
        { provide: AuthService, useValue: {} },
        { provide: ChatService, useValue: {} },
        { provide: AiService, useValue: {} },
        { provide: NftRewardService, useValue: {} },
        { provide: RewardsService, useValue: {} },
        { provide: RemindersService, useValue: {} },
        { provide: RedisService, useValue: {} },
        { provide: RoadmapStepStartBullmqService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();

    service = module.get<RoadmapService>(RoadmapService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
