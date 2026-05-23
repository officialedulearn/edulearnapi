import type { Job } from 'bullmq';

type SentryClient = typeof import('@sentry/nestjs');

const DEFAULT_TRACES_SAMPLE_RATE = 0.1;
const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off']);
const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-admin-api-key',
  'x-marketplace-api-key',
  'x-supabase-auth',
]);

type RecordValue = string | number | boolean | null | undefined;

let sentryClient: SentryClient | null | undefined;

function getSentryClient(): SentryClient | null {
  if (sentryClient !== undefined) {
    return sentryClient;
  }

  try {
    sentryClient = require('@sentry/nestjs') as SentryClient;
  } catch {
    sentryClient = null;
  }

  return sentryClient;
}

export interface SentryRuntimeConfig {
  enabled: boolean;
  dsn?: string;
  environment: string;
  release?: string;
  tracesSampleRate: number;
}

export interface RequestContext {
  method?: string;
  route?: string;
  url?: string;
  statusCode?: number;
  durationMs?: number;
  requestId?: string;
  userId?: string;
}

export interface JobContext {
  queueName: string;
  jobId?: string;
  jobName?: string;
  attemptsMade?: number;
  data?: unknown;
}

interface SanitizedSentryEvent {
  request?: {
    headers?: Record<string, unknown>;
    cookies?: unknown;
    data?: unknown;
  };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
}

function parseEnabled(raw: string | undefined, hasDsn: boolean): boolean {
  if (raw == null || raw.trim() === '') {
    return hasDsn;
  }
  return !DISABLED_VALUES.has(raw.trim().toLowerCase()) && hasDsn;
}

export function parseTracesSampleRate(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TRACES_SAMPLE_RATE;
  }

  return Math.min(1, Math.max(0, parsed));
}

export function getSentryRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): SentryRuntimeConfig {
  const dsn = env.SENTRY_DSN?.trim();
  const release = env.SENTRY_RELEASE?.trim();

  return {
    enabled: parseEnabled(env.SENTRY_ENABLED, Boolean(dsn)),
    ...(dsn ? { dsn } : {}),
    environment: env.SENTRY_ENVIRONMENT?.trim() || env.NODE_ENV || 'development',
    ...(release ? { release } : {}),
    tracesSampleRate: parseTracesSampleRate(env.SENTRY_TRACES_SAMPLE_RATE),
  };
}

export function sanitizeHeaders(
  headers: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!headers) {
    return headers;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? '[Filtered]' : value,
    ]),
  );
}

export function sanitizeSentryEvent<TEvent extends SanitizedSentryEvent>(
  event: TEvent,
): TEvent {
  if (event.request) {
    event.request.headers = sanitizeHeaders(event.request.headers);
    delete event.request.cookies;
    delete event.request.data;
  }

  return event;
}

export function initializeSentry(): SentryRuntimeConfig {
  const config = getSentryRuntimeConfig();

  if (!config.enabled || !config.dsn) {
    return config;
  }

  const client = getSentryClient();
  if (!client) {
    return {
      ...config,
      enabled: false,
    };
  }

  client.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    sendDefaultPii: false,
    beforeSend(event) {
      return sanitizeSentryEvent(event);
    },
  });

  return config;
}

function getSafeJobData(data: unknown): Record<string, RecordValue> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }

  const source = data as Record<string, unknown>;
  const safeKeys = ['userId', 'chatId', 'quizId', 'stepId', 'reason'];
  const safeData: Record<string, RecordValue> = {};

  for (const key of safeKeys) {
    const value = source[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value == null
    ) {
      safeData[key] = value;
    }
  }

  return safeData;
}

export function addRequestBreadcrumb(context: RequestContext): void {
  if (!getSentryRuntimeConfig().enabled) {
    return;
  }

  const client = getSentryClient();
  if (!client) {
    return;
  }

  client.addBreadcrumb({
    category: 'http.request',
    level: context.statusCode != null && context.statusCode >= 500 ? 'error' : 'info',
    message: `${context.method ?? 'HTTP'} ${context.route ?? context.url ?? ''}`.trim(),
    data: {
      statusCode: context.statusCode,
      durationMs: context.durationMs,
      requestId: context.requestId,
    },
  });
}

export function setRequestContext(context: RequestContext): void {
  if (!getSentryRuntimeConfig().enabled) {
    return;
  }

  const client = getSentryClient();
  if (!client) {
    return;
  }

  client.setContext('request', {
    method: context.method,
    route: context.route,
    url: context.url,
    statusCode: context.statusCode,
    durationMs: context.durationMs,
    requestId: context.requestId,
  });

  if (context.userId) {
    client.setUser({ id: context.userId });
  }
}

export function captureException(
  exception: unknown,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  },
): void {
  if (!getSentryRuntimeConfig().enabled) {
    return;
  }

  const client = getSentryClient();
  if (!client) {
    return;
  }

  client.withScope((scope) => {
    for (const [key, value] of Object.entries(context?.tags ?? {})) {
      scope.setTag(key, value);
    }
    for (const [key, value] of Object.entries(context?.extra ?? {})) {
      scope.setExtra(key, value);
    }
    client.captureException(exception);
  });
}

export async function startSentrySpan<TResult>(
  options: { name: string; op: string; attributes?: Record<string, RecordValue> },
  callback: () => Promise<TResult>,
): Promise<TResult> {
  if (!getSentryRuntimeConfig().enabled) {
    return callback();
  }

  const client = getSentryClient();
  if (!client) {
    return callback();
  }

  return client.startSpan(
    {
      name: options.name,
      op: options.op,
      attributes: options.attributes,
    },
    callback,
  );
}

export function captureWorkerError(queueName: string, error: Error): void {
  captureException(error, {
    tags: {
      queue: queueName,
      component: 'bullmq.worker',
      event: 'worker.error',
    },
  });
}

export function captureJobFailure<TData>(
  queueName: string,
  job: Job<TData> | undefined,
  error: Error,
): void {
  const context: JobContext = {
    queueName,
    jobId: job?.id,
    jobName: job?.name,
    attemptsMade: job?.attemptsMade,
    data: getSafeJobData(job?.data),
  };

  captureException(error, {
    tags: {
      queue: queueName,
      component: 'bullmq.job',
      event: 'job.failed',
    },
    extra: {
      job: context,
    },
  });
}
