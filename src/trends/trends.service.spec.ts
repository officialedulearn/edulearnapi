import { Test, TestingModule } from '@nestjs/testing';
import { TrendsService } from './trends.service';
import { RedisService } from '../redis/redis.service';

const hubTrends = {
  users: [
    {
      id: 'user-1',
      name: 'Ada',
      username: 'ada',
      profilePictureURL: null,
      level: 'beginner',
      xp: 100,
      followersCount: 4,
    },
  ],
  quizzes: [
    {
      id: 'quiz-1',
      title: 'Solana Basics',
      description: null,
      createdBy: 'user-1',
      creatorUsername: 'ada',
      viewCount: 12,
      attemptCount: 8,
      createdAt: '2026-05-19T00:00:00.000Z',
    },
  ],
};

describe('TrendsService', () => {
  let service: TrendsService;
  let redisService: {
    getHubTrendsPayload: jest.Mock;
    setHubTrendsPayload: jest.Mock;
  };

  beforeEach(async () => {
    redisService = {
      getHubTrendsPayload: jest.fn(),
      setHubTrendsPayload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrendsService,
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<TrendsService>(TrendsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns cached hub trends without querying the database', async () => {
    redisService.getHubTrendsPayload.mockResolvedValue(
      JSON.stringify(hubTrends),
    );
    const fetchSpy = jest.spyOn(
      service as unknown as { fetchHubTrendsFromDb: jest.Mock },
      'fetchHubTrendsFromDb',
    );

    await expect(service.getHubTrends(10)).resolves.toEqual(hubTrends);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(redisService.getHubTrendsPayload).toHaveBeenCalledWith(
      'trends:hub:v1:limit:10',
    );
  });

  it('queries the database and writes Redis on a cache miss', async () => {
    redisService.getHubTrendsPayload.mockResolvedValue(null);
    jest
      .spyOn(
        service as unknown as { fetchHubTrendsFromDb: jest.Mock },
        'fetchHubTrendsFromDb',
      )
      .mockResolvedValue(hubTrends);

    await expect(service.getHubTrends(10)).resolves.toEqual(hubTrends);
    expect(redisService.setHubTrendsPayload).toHaveBeenCalledWith(
      'trends:hub:v1:limit:10',
      60,
      JSON.stringify(hubTrends),
    );
  });

  it('falls back to database trends when Redis read fails', async () => {
    redisService.getHubTrendsPayload.mockRejectedValue(new Error('redis down'));
    jest
      .spyOn(
        service as unknown as { fetchHubTrendsFromDb: jest.Mock },
        'fetchHubTrendsFromDb',
      )
      .mockResolvedValue(hubTrends);

    await expect(service.getHubTrends(10)).resolves.toEqual(hubTrends);
  });

  it('uses default limit and caps large limits', async () => {
    redisService.getHubTrendsPayload.mockResolvedValue(null);
    const fetchSpy = jest
      .spyOn(
        service as unknown as { fetchHubTrendsFromDb: jest.Mock },
        'fetchHubTrendsFromDb',
      )
      .mockResolvedValue(hubTrends);

    await service.getHubTrends(Number.NaN);
    await service.getHubTrends(50);

    expect(fetchSpy).toHaveBeenNthCalledWith(1, 5);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, 25);
  });
});
