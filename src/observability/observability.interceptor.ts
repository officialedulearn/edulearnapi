import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  addRequestBreadcrumb,
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

function getUserId(request: RequestWithUser): string | undefined {
  return request.user?.id ?? request.user?.userId ?? request.user?.sub;
}

@Injectable()
export class ObservabilityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.recordRequest(request, Date.now() - start),
        error: () => this.recordRequest(request, Date.now() - start),
      }),
    );
  }

  private recordRequest(request: RequestWithUser, durationMs: number): void {
    const statusCode = request.raw?.statusCode;
    const route = request.routeOptions?.url;
    const url = sanitizeRequestUrl(request.url) ?? route ?? '';
    const method = request.method;

    setRequestContext({
      method,
      route,
      url,
      statusCode,
      durationMs,
      requestId: request.id,
      userId: getUserId(request),
    });
    addRequestBreadcrumb({
      method,
      route,
      url,
      statusCode,
      durationMs,
      requestId: request.id,
    });

    console.log(`${method} ${url} - ${durationMs}ms`);
  }
}
