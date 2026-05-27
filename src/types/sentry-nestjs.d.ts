declare module '@sentry/nestjs' {
  export interface SentryEvent {
    request?: {
      headers?: Record<string, unknown>;
      cookies?: unknown;
      data?: unknown;
    };
    extra?: Record<string, unknown>;
    contexts?: Record<string, unknown>;
  }

  export interface Scope {
    setTag(key: string, value: string): void;
    setExtra(key: string, value: unknown): void;
  }

  export interface InitOptions {
    dsn?: string;
    environment?: string;
    release?: string;
    tracesSampleRate?: number;
    sendDefaultPii?: boolean;
    beforeSend?: (event: SentryEvent) => SentryEvent | null;
  }

  export function init(options: InitOptions): void;
  export function addBreadcrumb(breadcrumb: Record<string, unknown>): void;
  export function setContext(
    name: string,
    context: Record<string, unknown>,
  ): void;
  export function setUser(user: { id: string }): void;
  export function withScope(callback: (scope: Scope) => void): void;
  export function captureException(exception: unknown): void;
  export function startSpan<TResult>(
    options: {
      name: string;
      op: string;
      attributes?: Record<string, string | number | boolean | null | undefined>;
    },
    callback: () => TResult,
  ): TResult;
}
