import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  captureException,
  sanitizeRequestUrl,
  setRequestContext,
} from './sentry';

interface RequestWithUser extends FastifyRequest {
  user?: {
    id?: string;
    sub?: string;
    userId?: string;
  };
}

function getStatus(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

function getErrorResponse(exception: unknown, statusCode: number): unknown {
  if (exception instanceof HttpException) {
    return exception.getResponse();
  }

  return {
    statusCode,
    message: 'Internal server error',
  };
}

function getUserId(request: RequestWithUser): string | undefined {
  return request.user?.id ?? request.user?.userId ?? request.user?.sub;
}

@Catch()
export class SentryExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<RequestWithUser>();
    const response = context.getResponse<FastifyReply>();
    const statusCode = getStatus(exception);

    setRequestContext({
      method: request.method,
      route: request.routeOptions?.url,
      url: sanitizeRequestUrl(request.url),
      statusCode,
      requestId: request.id,
      userId: getUserId(request),
    });

    if (statusCode >= 500 || !(exception instanceof HttpException)) {
      const route =
        request.routeOptions?.url ?? sanitizeRequestUrl(request.url) ?? 'unknown';
      captureException(exception, {
        tags: {
          method: request.method,
          route,
          status_code: String(statusCode),
        },
        extra: {
          requestId: request.id,
        },
      });
    }

    response.status(statusCode).send(getErrorResponse(exception, statusCode));
  }
}
