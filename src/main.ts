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

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { rawBody: true },
  );

  const fastifyInstance = app.getHttpAdapter().getInstance();
  await fastifyInstance.register(multipart as never, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  await fastifyInstance.register(fastifyHelmet as never);
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

  const internalConfig = new DocumentBuilder()
    .setTitle('EduLearn API')
    .setDescription('Complete API documentation for internal use')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-api-key',
        in: 'header',
      },
      'api-key',
    )
    .build();

  const internalDocument = SwaggerModule.createDocument(app, internalConfig);
  SwaggerModule.setup('api/docs', app, internalDocument, {
    customSiteTitle: 'EduLearn API Documentation',
  });

  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();
