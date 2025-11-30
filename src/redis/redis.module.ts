import { Module } from '@nestjs/common';
import { createClient } from 'redis';
import { RedisService } from './redis.service';

@Module({
  providers: [
    {
      provide: 'REDIS',
      useFactory: async () => {
        const client = createClient({
          url: process.env.REDIS_URL,
        });
        await client.connect();
        return client;
      },
    },
    RedisService
  ],
  exports: ['REDIS', RedisService]
})
export class RedisModule {}
