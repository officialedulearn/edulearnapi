jest.mock(
  '@sentry/nestjs',
  () => ({
    init: jest.fn(),
    addBreadcrumb: jest.fn(),
    setContext: jest.fn(),
    setUser: jest.fn(),
    withScope: jest.fn(),
    captureException: jest.fn(),
    startSpan: jest.fn((_options, callback) => callback()),
  }),
  { virtual: true },
);

import { QueueHealthService } from 'src/observability/queue-health.service';
import type { RedisService } from 'src/redis/redis.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const originalEnv = process.env;

  let redisService: Pick<RedisService, 'ping'>;
  let queueHealth: QueueHealthService;
  let service: HealthService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    redisService = {
      ping: jest.fn().mockResolvedValue('PONG'),
    };
    queueHealth = new QueueHealthService();
    service = new HealthService(redisService as RedisService, queueHealth);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns ready when Redis is healthy', async () => {
    const result = await service.getReadiness();

    expect(result.status).toBe('ready');
    expect(result.dependencies).toContainEqual({
      name: 'redis',
      status: 'ok',
      message: 'PONG',
    });
  });

  it('returns unready when Redis ping fails', async () => {
    jest.mocked(redisService.ping).mockRejectedValueOnce(new Error('offline'));

    const result = await service.getReadiness();

    expect(result.status).toBe('unready');
    expect(result.dependencies).toContainEqual({
      name: 'redis',
      status: 'error',
      message: 'offline',
    });
  });

  it('reports missing provider envs without crashing', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;

    const result = await service.getDependencies();

    expect(result.status).toBe('degraded');
    expect(result.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'gemini', status: 'missing' }),
        expect.objectContaining({ name: 'resend', status: 'missing' }),
        expect.objectContaining({ name: 'cloudinary', status: 'missing' }),
      ]),
    );
  });

  it('includes queue health snapshots', async () => {
    queueHealth.register('test-queue');
    queueHealth.markReady('test-queue');

    const result = await service.getDependencies();

    expect(result.queues).toEqual([
      expect.objectContaining({
        queueName: 'test-queue',
        status: 'ready',
      }),
    ]);
  });
});
