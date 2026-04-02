import { Module, Logger } from '@nestjs/common';
import { createClient } from 'redis';
import { RedisService } from './redis.service';

const logger = new Logger('RedisModule');

async function createRedisClient() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  const client = createClient({
    url: redisUrl,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error(
            'Redis connection failed after 10 retries. Please ensure Redis is running.',
          );
          return new Error('Redis connection failed');
        }
        const delay = Math.min(retries * 100, 3000);
        logger.warn(`Redis connection retry ${retries} in ${delay}ms...`);
        return delay;
      },
    },
  });

  client.on('error', (err) => {
    logger.error(`Redis Client Error: ${err.message}`);
  });

  client.on('connect', () => {
    logger.log('Redis client connecting...');
  });

  client.on('ready', () => {
    logger.log('Redis client connected and ready');
  });

  client.on('reconnecting', () => {
    logger.warn('Redis client reconnecting...');
  });

  try {
    await client.connect();
    logger.log('Redis connection established successfully');
    return client;
  } catch (error) {
    logger.error(`Failed to connect to Redis: ${error.message}`);
    logger.error('Please ensure Redis is running. You can start it with:');
    logger.error('  - Docker: docker run -d -p 6379:6379 redis:alpine');
    logger.error(
      '  - Windows: Download and run Redis from https://github.com/microsoftarchive/redis/releases',
    );
    logger.error(
      '  - Or set REDIS_URL environment variable to your Redis instance',
    );
    throw error;
  }
}

@Module({
  providers: [
    {
      provide: 'REDIS',
      useFactory: createRedisClient,
    },
    RedisService,
  ],
  exports: ['REDIS', RedisService],
})
export class RedisModule {}
