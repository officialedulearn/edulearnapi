jest.mock(
  '@sentry/nestjs',
  () => ({
    init: jest.fn(),
    addBreadcrumb: jest.fn(),
    setContext: jest.fn(),
    setUser: jest.fn(),
    withScope: jest.fn(),
    captureException: jest.fn(),
    startSpan: jest.fn((_options, callback) => callback()),
  }),
  { virtual: true },
);

import {
  getSentryRuntimeConfig,
  parseTracesSampleRate,
  sanitizeSentryEvent,
} from './sentry';

describe('Sentry observability config', () => {
  it('is disabled when SENTRY_DSN is missing', () => {
    expect(getSentryRuntimeConfig({}).enabled).toBe(false);
  });

  it('defaults traces sample rate to 0.1', () => {
    expect(parseTracesSampleRate(undefined)).toBe(0.1);
    expect(
      getSentryRuntimeConfig({ SENTRY_DSN: 'https://example.test/1' }),
    ).toMatchObject({
      enabled: true,
      tracesSampleRate: 0.1,
    });
  });

  it('clamps invalid traces sample rates', () => {
    expect(parseTracesSampleRate('not-a-number')).toBe(0.1);
    expect(parseTracesSampleRate('-1')).toBe(0);
    expect(parseTracesSampleRate('2')).toBe(1);
  });

  it('filters sensitive request fields before sending events', () => {
    const event = sanitizeSentryEvent({
      request: {
        headers: {
          authorization: 'Bearer secret',
          cookie: 'session=secret',
          'x-api-key': 'secret',
          accept: 'application/json',
        },
        cookies: { session: 'secret' },
        data: { password: 'secret' },
      },
    });

    expect(event.request?.headers).toEqual({
      authorization: '[Filtered]',
      cookie: '[Filtered]',
      'x-api-key': '[Filtered]',
      accept: 'application/json',
    });
    expect(event.request).not.toHaveProperty('cookies');
    expect(event.request).not.toHaveProperty('data');
  });
});
