import { ResendService } from './resend.service';

jest.mock('../../drizzle', () => ({
  __esModule: true,
  default: {
    select: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock('src/observability/sentry', () => ({
  startSentrySpan: jest.fn((_span, callback) => callback()),
}));

import db from '../../drizzle';

const mockDb = db as unknown as {
  select: jest.Mock;
  update: jest.Mock;
};

const createSelectChain = (result: unknown[]) => ({
  from: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue(result),
    }),
  }),
});

const createUpdateChain = () => ({
  set: jest.fn().mockReturnValue({
    where: jest.fn().mockResolvedValue(undefined),
  }),
});

describe('ResendService', () => {
  let service: ResendService;
  let resend: {
    emails: { send: jest.Mock };
    contacts: { list: jest.Mock; create: jest.Mock };
    broadcasts: { create: jest.Mock; send: jest.Mock };
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.UNSUBSCRIBE_SECRET = 'unit-test-secret';
    process.env.WEB_BASE_URL = 'https://edulearn.fun';
    resend = {
      emails: {
        send: jest.fn().mockResolvedValue({ data: { id: 'email_1' } }),
      },
      contacts: {
        list: jest.fn(),
        create: jest.fn(),
      },
      broadcasts: {
        create: jest.fn(),
        send: jest.fn(),
      },
    };
    mockDb.select.mockReset();
    mockDb.update.mockReset();
    service = new ResendService(resend as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns active for a valid subscribed user token', async () => {
    const token = service.createUnsubscribeToken('Learner@Example.com');
    mockDb.select.mockReturnValueOnce(
      createSelectChain([{ emailSubscribed: true }]),
    );

    await expect(service.getUnsubscribeStatus(token)).resolves.toEqual({
      status: 'active',
    });
  });

  it('returns invalid for a malformed token', async () => {
    await expect(service.getUnsubscribeStatus('bad-token')).resolves.toEqual({
      status: 'invalid',
    });
  });

  it('returns expired for an expired token', async () => {
    jest.spyOn(Date, 'now').mockReturnValueOnce(1_000);
    const token = service.createUnsubscribeToken('learner@example.com');
    jest.spyOn(Date, 'now').mockReturnValueOnce(31_536_002_000);

    await expect(service.getUnsubscribeStatus(token)).resolves.toEqual({
      status: 'expired',
    });
  });

  it('unsubscribes a subscribed user', async () => {
    const token = service.createUnsubscribeToken('learner@example.com');
    mockDb.select.mockReturnValueOnce(
      createSelectChain([{ emailSubscribed: true }]),
    );
    mockDb.update.mockReturnValueOnce(createUpdateChain());

    await expect(service.unsubscribe(token)).resolves.toEqual({
      status: 'unsubscribed',
    });
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('returns already_unsubscribed without updating the user', async () => {
    const token = service.createUnsubscribeToken('learner@example.com');
    mockDb.select.mockReturnValueOnce(
      createSelectChain([{ emailSubscribed: false }]),
    );

    await expect(service.unsubscribe(token)).resolves.toEqual({
      status: 'already_unsubscribed',
    });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('skips sendEmail for unsubscribed users', async () => {
    mockDb.select.mockReturnValueOnce(
      createSelectChain([{ emailSubscribed: false }]),
    );

    await expect(
      service.sendEmail('learner@example.com', 'Subject', '<p>Hello</p>'),
    ).resolves.toEqual({
      skipped: true,
      reason: 'email_unsubscribed',
      email: 'learner@example.com',
    });
    expect(resend.emails.send).not.toHaveBeenCalled();
  });

  it('adds a signed unsubscribe link before sending subscribed user email', async () => {
    mockDb.select.mockReturnValueOnce(
      createSelectChain([{ emailSubscribed: true }]),
    );

    await service.sendEmail(
      'Learner@Example.com',
      'Subject',
      '<body><p>Hello</p></body>',
    );

    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'learner@example.com',
        html: expect.stringContaining(
          'https://edulearn.fun/unsubscribe?token=',
        ),
      }),
    );
  });
});
