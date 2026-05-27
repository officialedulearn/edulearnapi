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

const mockDb = {
  select: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  transaction: jest.fn(),
};

jest.mock('../../drizzle', () => ({
  __esModule: true,
  default: mockDb,
}));

import { RoadmapService } from './roadmap.service';
import { AuthService } from 'src/auth/auth.service';
import { ChatService } from 'src/chat/chat.service';
import { AiService } from 'src/ai/ai.service';
import { QuizGenerationService } from 'src/ai/quiz-generation.service';
import { NftRewardService } from 'src/ai/nft-reward.service';
import { RewardsService } from 'src/rewards/rewards.service';
import { RemindersService } from 'src/reminders/reminders.service';
import { RedisService } from 'src/redis/redis.service';
import { RoadmapStepStartBullmqService } from './roadmap-step-start-bullmq.service';
import { NotificationsService } from 'src/common/services/notifications.service';

describe('RoadmapService', () => {
  let service: RoadmapService;
  const quizGenerationService = {
    generateRoadmapVerificationQuiz: jest.fn(),
  };
  const redisService = {
    deleteRoadmapPayload: jest.fn(),
  };
  const remindersService = {
    enqueueEvaluation: jest.fn(),
  };

  const questions = Array.from({ length: 5 }, (_, index) => ({
    question: `Question ${index + 1}`,
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
    explanation: 'Because A is correct.',
  }));

  const makeSelectLimitChain = (result: unknown[]) => {
    const chain: any = {};
    chain.from = jest.fn(() => chain);
    chain.where = jest.fn(() => chain);
    chain.limit = jest.fn(() => Promise.resolve(result));
    return chain;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    remindersService.enqueueEvaluation.mockResolvedValue(undefined);
    redisService.deleteRoadmapPayload.mockResolvedValue(undefined);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoadmapService,
        { provide: AuthService, useValue: {} },
        { provide: ChatService, useValue: {} },
        { provide: AiService, useValue: {} },
        { provide: QuizGenerationService, useValue: quizGenerationService },
        { provide: NftRewardService, useValue: {} },
        { provide: RewardsService, useValue: {} },
        { provide: RemindersService, useValue: remindersService },
        { provide: RedisService, useValue: redisService },
        { provide: RoadmapStepStartBullmqService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();

    service = module.get<RoadmapService>(RoadmapService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates private verification quizzes outside the public quiz flow', async () => {
    jest.spyOn(service as any, 'getAuthorizedRoadmapSubStep').mockResolvedValue({
      subStep: {
        id: 'sub-step-1',
        title: 'Explain variables',
        description: 'Describe what variables do.',
        context: 'Variables store values.',
      },
      step: {
        id: 'step-1',
        title: 'Programming basics',
        description: 'Learn basic programming terms.',
      },
      roadmapData: {
        id: 'roadmap-1',
        title: 'Learn JavaScript',
      },
    });
    quizGenerationService.generateRoadmapVerificationQuiz.mockResolvedValue(
      questions,
    );
    const returning = jest.fn().mockResolvedValue([
      {
        id: 'verification-quiz-1',
        roadmapId: 'roadmap-1',
        stepId: 'step-1',
        subStepId: 'sub-step-1',
        questions,
        createdAt: new Date('2026-05-26T00:00:00.000Z'),
      },
    ]);
    const values = jest.fn(() => ({ returning }));
    mockDb.insert.mockReturnValueOnce({ values });

    const result = await service.startSubStepVerification(
      'sub-step-1',
      'user-1',
    );

    expect(result.quiz.questions).toHaveLength(5);
    expect(result.quiz.questions[0]).toEqual({
      question: 'Question 1',
      options: ['A', 'B', 'C', 'D'],
    });
    expect(result.quiz.questions[0]).not.toHaveProperty('correctAnswer');
    expect(result.quiz.questions[0]).not.toHaveProperty('explanation');
    expect(result.passingScore).toBe(4);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        roadmapId: 'roadmap-1',
        stepId: 'step-1',
        subStepId: 'sub-step-1',
        questions,
      }),
    );
  });

  it('rejects duplicate verification answer indexes', async () => {
    mockDb.select.mockReturnValueOnce(
      makeSelectLimitChain([
        {
          id: 'verification-quiz-1',
          userId: 'user-1',
          roadmapId: 'roadmap-1',
          stepId: 'step-1',
          subStepId: 'sub-step-1',
          questions,
        },
      ]),
    );

    await expect(
      service.submitSubStepVerificationAttempt('verification-quiz-1', 'user-1', [
        { questionIndex: 0, selectedAnswer: 'A' },
        { questionIndex: 0, selectedAnswer: 'A' },
        { questionIndex: 2, selectedAnswer: 'A' },
        { questionIndex: 3, selectedAnswer: 'A' },
        { questionIndex: 4, selectedAnswer: 'A' },
      ]),
    ).rejects.toThrow('Invalid questionIndex 0');

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});
