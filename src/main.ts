import { initializeSentry } from './observability/sentry';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import multipart from '@fastify/multipart';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';
import { ObservabilityInterceptor } from './observability/observability.interceptor';
import { SentryExceptionFilter } from './observability/sentry-exception.filter';

initializeSentry();

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
    }),
    {
      rawBody: true,
    },
  );

  const fastifyInstance = app.getHttpAdapter().getInstance();
  await fastifyInstance.register(multipart as never, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  await fastifyInstance.register(fastifyHelmet as never, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", 'https:', 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        upgradeInsecureRequests: [],
      },
    },
  });
  await fastifyInstance.register(fastifyCompress as never);

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalInterceptors(new ObservabilityInterceptor());
  app.useGlobalFilters(new SentryExceptionFilter());

  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();
