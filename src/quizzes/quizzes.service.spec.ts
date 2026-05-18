import { Test, TestingModule } from '@nestjs/testing';
import db from '../../drizzle';
import { QuizzesService } from './quizzes.service';
import { ActivityService } from '../activity/activity.service';
import { RemindersService } from 'src/reminders/reminders.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

jest.mock('../activity/activity.service', () => ({
  ActivityService: class ActivityService {},
}));

jest.mock('src/reminders/reminders.service', () => ({
  RemindersService: class RemindersService {},
}));

jest.mock('../../drizzle', () => ({
  __esModule: true,
  default: {
    select: jest.fn(),
    update: jest.fn(),
    insert: jest.fn(),
  },
}));

const makeQuery = (result: any) => {
  const query: any = {};
  query.from = jest.fn(() => query);
  query.where = jest.fn(() => query);
  query.orderBy = jest.fn(() => query);
  query.limit = jest.fn(() => Promise.resolve(result));
  query.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return query;
};

const makeUpdateChain = () => {
  const chain: any = {};
  chain.set = jest.fn(() => chain);
  chain.where = jest.fn(() => Promise.resolve(undefined));
  return chain;
};

describe('QuizzesService', () => {
  let service: QuizzesService;
  const selectMock = (db as any).select as jest.Mock;
  const updateMock = (db as any).update as jest.Mock;
  const insertMock = (db as any).insert as jest.Mock;

  const activityService = {
    submitQuiz: jest.fn(),
  };
  const remindersService = {
    enqueueEvaluation: jest.fn(),
  };

  beforeEach(async () => {
    selectMock.mockReset();
    updateMock.mockReset();
    insertMock.mockReset();
    activityService.submitQuiz.mockReset();
    remindersService.enqueueEvaluation.mockReset();
    remindersService.enqueueEvaluation.mockResolvedValue(undefined);

    updateMock
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeUpdateChain())
      .mockReturnValueOnce(makeUpdateChain());

    insertMock.mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuizzesService,
        { provide: ActivityService, useValue: activityService },
        { provide: RemindersService, useValue: remindersService },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn() } },
      ],
    }).compile();

    service = module.get<QuizzesService>(QuizzesService);
  });

  it('persists per-question attempt snapshots on submit', async () => {
    jest.spyOn(service as any, 'getQuizByIdOrThrow').mockResolvedValue({
      id: 'quiz-1',
      title: 'Test Quiz',
      questions: [
        {
          question: 'What is Solana?',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 'A',
          explanation: 'Solana is a high-throughput blockchain.',
        },
      ],
    });

    selectMock.mockReturnValueOnce(
      makeQuery([
        {
          id: 'part-1',
          userId: 'user-1',
          quizId: 'quiz-1',
          submittedAt: null,
        },
      ]),
    );

    activityService.submitQuiz.mockResolvedValue({
      xpEarned: 1,
      activity: { id: 'act-1' },
    });

    await service.submitAttempt('quiz-1', 'user-1', {
      userId: 'user-1',
      participationId: 'part-1',
      answers: [{ questionIndex: 0, selectedAnswer: 'A' }],
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const valuesMock = insertMock.mock.results[0].value.values as jest.Mock;
    expect(valuesMock).toHaveBeenCalledTimes(1);
    const payload = valuesMock.mock.calls[0][0];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0]).toMatchObject({
      userId: 'user-1',
      quizId: 'quiz-1',
      participationId: 'part-1',
      questionIndex: 0,
      question: 'What is Solana?',
      selectedAnswer: 'A',
      correctAnswer: 'A',
      explanation: 'Solana is a high-throughput blockchain.',
      isCorrect: true,
    });
  });
});
