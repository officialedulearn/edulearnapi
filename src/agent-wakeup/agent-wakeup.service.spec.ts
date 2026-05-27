import { Test, TestingModule } from '@nestjs/testing';
import db from '../../drizzle';
import { ChatService } from 'src/chat/chat.service';
import { NotificationsService } from 'src/common/services/notifications.service';
import { AgentWakeupBullmqService } from './agent-wakeup-bullmq.service';
import { AgentWakeupDecisionService } from './agent-wakeup-decision.service';
import { AgentWakeupService } from './agent-wakeup.service';

jest.mock('../../drizzle', () => ({
  __esModule: true,
  default: {
    select: jest.fn(),
    insert: jest.fn(),
  },
}));

const makeQuery = (result: any) => {
  const query: any = {};
  query.from = jest.fn(() => query);
  query.where = jest.fn(() => query);
  query.orderBy = jest.fn(() => query);
  query.limit = jest.fn(() => Promise.resolve(result));
  query.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return query;
};

describe('AgentWakeupService', () => {
  let service: AgentWakeupService;
  let decision: { decide: jest.Mock };
  let chatService: { createChat: jest.Mock; saveMessages: jest.Mock };
  let notificationsService: { createNotification: jest.Mock };

  const selectMock = (db as any).select as jest.Mock;
  const insertMock = (db as any).insert as jest.Mock;

  beforeEach(async () => {
    decision = { decide: jest.fn() };
    chatService = {
      createChat: jest.fn().mockResolvedValue({ id: 'chat-1' }),
      saveMessages: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };

    insertMock.mockReset();
    insertMock.mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    });
    selectMock.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentWakeupService,
        {
          provide: AgentWakeupBullmqService,
          useValue: { getQueue: jest.fn() },
        },
        { provide: AgentWakeupDecisionService, useValue: decision },
        { provide: ChatService, useValue: chatService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<AgentWakeupService>(AgentWakeupService);
    delete process.env.AGENT_WAKEUP_ENABLED;
    delete process.env.AGENT_WAKEUP_MAX_PER_7_DAYS;
    delete process.env.AGENT_WAKEUP_DAILY_CAP;
  });

  it('skips when disabled by env', async () => {
    process.env.AGENT_WAKEUP_ENABLED = 'false';
    const out = await service.evaluateUser({
      userId: 'user-1',
      reason: 'manual',
      dryRun: true,
    });
    expect(out.sent).toBe(false);
    expect(out.blockedBy).toBe('disabled_by_env');
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('skips when user has no agent', async () => {
    selectMock
      .mockReturnValueOnce(
        makeQuery([
          {
            id: 'user-1',
            name: 'Test User',
            level: 'novice',
            learning: 'Solana',
            memory: '',
            lastLoggedIn: new Date(),
          },
        ]),
      )
      .mockReturnValueOnce(makeQuery([]));

    const out = await service.evaluateUser({
      userId: 'user-1',
      reason: 'manual',
      dryRun: true,
    });

    expect(out.sent).toBe(false);
    expect(out.blockedBy).toBe('no_agent');
  });

  it('enforces rolling weekly cap', async () => {
    process.env.AGENT_WAKEUP_MAX_PER_7_DAYS = '2';
    selectMock
      .mockReturnValueOnce(
        makeQuery([
          {
            id: 'user-1',
            name: 'Test User',
            level: 'novice',
            learning: 'Solana',
            memory: '',
            lastLoggedIn: new Date(),
          },
        ]),
      )
      .mockReturnValueOnce(
        makeQuery([
          {
            id: 'agent-1',
            userId: 'user-1',
            name: 'Eddy',
            purpose: 'Help user improve',
          },
        ]),
      )
      .mockReturnValueOnce(makeQuery([{ id: 'w1' }, { id: 'w2' }]));

    const out = await service.evaluateUser({
      userId: 'user-1',
      reason: 'manual',
      dryRun: true,
    });

    expect(out.sent).toBe(false);
    expect(out.blockedBy).toBe('weekly_cap');
  });

  it('sends new chat + notification when eligible and no quiz history', async () => {
    decision.decide.mockResolvedValue({
      decision: {
        chatTitle: 'Quick check-in',
        messageText: 'Here is a short tip for your roadmap progress.',
        why: 'coach_now',
      },
      modelMeta: { model: 'gemini-2.5-flash' },
    });

    selectMock
      .mockReturnValueOnce(
        makeQuery([
          {
            id: 'user-1',
            name: 'Test User',
            level: 'novice',
            learning: 'Solana',
            memory: 'Wants to improve consistency',
            lastLoggedIn: new Date(),
          },
        ]),
      )
      .mockReturnValueOnce(
        makeQuery([
          {
            id: 'agent-1',
            userId: 'user-1',
            name: 'Eddy',
            purpose: 'Help user improve',
          },
        ]),
      )
      .mockReturnValueOnce(makeQuery([]))
      .mockReturnValueOnce(makeQuery([]))
      .mockReturnValueOnce(makeQuery([]))
      .mockReturnValueOnce(
        makeQuery([
          {
            topic: 'Solana basics',
            title: 'Solana Learning Path',
            description: 'Start with core concepts',
          },
        ]),
      )
      .mockReturnValueOnce(makeQuery([]));

    const out = await service.evaluateUser({
      userId: 'user-1',
      reason: 'manual',
      dryRun: false,
    });

    expect(out.sent).toBe(true);
    expect(out.chatId).toBe('chat-1');
    expect(chatService.createChat).toHaveBeenCalledWith({
      title: 'Quick check-in',
      userId: 'user-1',
    });
    expect(chatService.saveMessages).toHaveBeenCalledTimes(1);
    expect(notificationsService.createNotification).toHaveBeenCalledTimes(1);
    expect(
      notificationsService.createNotification.mock.calls[0][0],
    ).toMatchObject({
      userId: 'user-1',
      type: 'agent_message',
      metadata: {
        chatId: 'chat-1',
        agentId: 'agent-1',
      },
    });
  });

  it('skips inactive users for scheduled runs', async () => {
    process.env.AGENT_WAKEUP_ACTIVE_DAYS = '30';
    const staleLogin = new Date();
    staleLogin.setUTCDate(staleLogin.getUTCDate() - 45);

    selectMock.mockReturnValueOnce(
      makeQuery([
        {
          id: 'user-1',
          name: 'Test User',
          level: 'novice',
          learning: 'Solana',
          memory: '',
          lastLoggedIn: staleLogin,
        },
      ]),
    );

    const out = await service.evaluateUser({
      userId: 'user-1',
      reason: 'scheduled',
      dryRun: true,
    });

    expect(out.sent).toBe(false);
    expect(out.blockedBy).toBe('inactive_user');
  });
});
