import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { rawBody: true },
    );
    const fastifyInstance = app.getHttpAdapter().getInstance();
    await fastifyInstance.register(multipart as never, {
      limits: { fileSize: 10 * 1024 * 1024 },
    });
    await fastifyInstance.register(fastifyHelmet as never);
    await fastifyInstance.register(fastifyCompress as never);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
