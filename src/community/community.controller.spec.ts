import { Test, TestingModule } from '@nestjs/testing';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { RedisService } from '../redis/redis.service';
import { RealtimePublisherService } from '../realtime/realtime.publisher';

describe('CommunityController', () => {
  let controller: CommunityController;
  let communityService: Record<string, jest.Mock>;
  let redisService: Record<string, jest.Mock>;
  let realtimePublisher: Record<string, jest.Mock>;

  beforeEach(async () => {
    communityService = {
      isUserMember: jest.fn(),
      createMessage: jest.fn(),
      createMention: jest.fn(),
      getMessageById: jest.fn(),
      getDisplayNameForSocket: jest.fn(),
    };
    redisService = {
      clearTyping: jest.fn(),
      setTyping: jest.fn(),
    };
    realtimePublisher = {
      publishToCommunityRoom: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommunityController],
      providers: [
        { provide: CommunityService, useValue: communityService },
        { provide: RedisService, useValue: redisService },
        { provide: RealtimePublisherService, useValue: realtimePublisher },
      ],
    }).compile();

    controller = module.get<CommunityController>(CommunityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('publishes realtime event after creating a message through REST', async () => {
    communityService.isUserMember.mockResolvedValue(true);
    communityService.createMessage.mockResolvedValue({ id: 'message-1' });
    communityService.getMessageById.mockResolvedValue({
      id: 'message-1',
      roomId: 'community-1',
      content: 'hello',
      createdAt: new Date().toISOString(),
      user: { id: 'user-1', username: 'ada', name: 'Ada' },
    });

    const result = await controller.createMessage(
      { user: { sub: 'user-1' } },
      'community-1',
      { content: 'hello' },
    );

    expect(redisService.clearTyping).toHaveBeenCalledWith(
      'community-1',
      'user-1',
    );
    expect(realtimePublisher.publishToCommunityRoom).toHaveBeenCalledWith(
      'community-1',
      'community.message.created',
      expect.objectContaining({ id: 'message-1', roomId: 'community-1' }),
    );
    expect(result).toEqual(
      expect.objectContaining({ id: 'message-1', roomId: 'community-1' }),
    );
  });

  it('publishes typing state through REST', async () => {
    communityService.isUserMember.mockResolvedValue(true);
    communityService.getDisplayNameForSocket.mockResolvedValue('ada');

    await controller.sendTyping({ user: { sub: 'user-1' } }, 'community-1', {
      isTyping: true,
    });

    expect(redisService.setTyping).toHaveBeenCalledWith(
      'community-1',
      'user-1',
      3,
    );
    expect(realtimePublisher.publishToCommunityRoom).toHaveBeenCalledWith(
      'community-1',
      'community.typing.started',
      expect.objectContaining({
        userId: 'user-1',
        username: 'ada',
        communityId: 'community-1',
      }),
    );
  });
});
