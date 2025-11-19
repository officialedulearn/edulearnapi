import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as compression from 'compression';
import helmet from 'helmet';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';

async function bootstrap() {
  // Create Express instance and configure body parser BEFORE NestJS uses it
  // This ensures body is only consumed once - Express parses it, NestJS reads from req.body
  const server = express();
  server.use(express.json({ limit: '50mb' }));
  server.use(express.urlencoded({ extended: true, limit: '50mb' }));
  
  // Create NestJS app with pre-configured Express instance
  // bodyParser: false ensures NestJS doesn't try to parse body again
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bodyParser: false,
  });
  
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  app.use(helmet());
  
  app.use(compression());
  
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

  const marketplaceConfig = new DocumentBuilder()
    .setTitle('EduLearn Marketplace API')
    .setDescription('API documentation for external marketplace integrations. Use the x-marketplace-key header for authentication.')
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-marketplace-key',
        in: 'header',
        description: 'Marketplace API key for external integrations',
      },
      'marketplace-key',
    )
    .addTag('chat', 'Chat management endpoints')
    .addTag('ai', 'AI and machine learning endpoints')
    .build();

  const marketplaceDocument = SwaggerModule.createDocument(app, marketplaceConfig, {
    include: [],
    operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
    deepScanRoutes: true,
  });

  const filteredPaths = {};
  Object.keys(marketplaceDocument.paths).forEach((path) => {
    if (path.startsWith('/chat') || path.startsWith('/ai')) {
      filteredPaths[path] = marketplaceDocument.paths[path];
    }
  });
  marketplaceDocument.paths = filteredPaths;

  SwaggerModule.setup('api/marketplace', app, marketplaceDocument, {
    customSiteTitle: 'EduLearn Marketplace API',
    customCss: '.swagger-ui .topbar { display: none }',
  });

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
        name: 'x-marketplace-key',
        in: 'header',
      },
      'marketplace-key',
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
