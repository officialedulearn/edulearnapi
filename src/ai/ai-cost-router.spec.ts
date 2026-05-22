import {
  aiCostRouteForUserMessage,
  normalizeUserText,
  getAiCostRouterConfig,
  deriveConversationContext,
  detectAssistantAwaitingUserReply,
  messageContentToPlainText,
  routeAiCostForUserMessage,
} from './ai-cost-router';

const SUBST_BODY = `${'paragraph '.repeat(40)}`; // ≥32 words substantive

describe('ai-cost-router', () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...prevEnv };
    process.env.AI_COST_ROUTER_ENABLED = 'true';
    process.env.AI_COST_ROUTER_FOLLOWUP = 'true';
    process.env.AI_COST_ROUTER_MIN_CHARS = '6';
    process.env.AI_COST_ROUTER_MIN_WORDS = '2';
  });

  afterAll(() => {
    process.env = prevEnv;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes text', () => {
    expect(normalizeUserText('  Hello!!!  ')).toBe('hello');
    expect(normalizeUserText('  ')).toBe('');
  });

  it('messageContentToPlainText reads json-shaped content', () => {
    expect(messageContentToPlainText({ text: '  hi  ' }).trim()).toBe('hi');
    expect(messageContentToPlainText('plain')).toBe('plain');
  });

  it('deriveConversationContext marks substantive assistant', () => {
    const empty = deriveConversationContext([]);
    expect(empty.hasRecentSubstantiveAssistant).toBe(false);
    expect(empty.assistantAwaitingUserReply).toBe(false);

    const shortAssist = deriveConversationContext([
      { role: 'assistant', content: { text: 'ok' } },
    ]);
    expect(shortAssist.hasRecentSubstantiveAssistant).toBe(false);
    expect(shortAssist.assistantAwaitingUserReply).toBe(false);

    const longAssist = deriveConversationContext([
      { role: 'assistant', content: { text: SUBST_BODY } },
    ]);
    expect(longAssist.hasRecentSubstantiveAssistant).toBe(true);
    expect(longAssist.assistantAwaitingUserReply).toBe(false);
  });

  it('detectAssistantAwaitingUserReply catches confirmation prompts', () => {
    expect(
      detectAssistantAwaitingUserReply(
        'I can generate a roadmap for TypeScript basics. Want me to go ahead?',
      ),
    ).toBe(true);
    expect(
      detectAssistantAwaitingUserReply(
        'Ready for me to create a quiz on React hooks?',
      ),
    ).toBe(true);
    expect(
      detectAssistantAwaitingUserReply(
        `${SUBST_BODY}\n\nShould I schedule daily flashcards for you?`,
      ),
    ).toBe(true);
    expect(
      detectAssistantAwaitingUserReply(
        `${SUBST_BODY}\n\nHere is the full breakdown of closures in JavaScript.`,
      ),
    ).toBe(false);
  });

  it('calls model when user confirms an assistant prompt', () => {
    const ctx = {
      hasRecentSubstantiveAssistant: true,
      assistantAwaitingUserReply: true,
    };
    for (const userText of [
      'okay',
      'okayy',
      'okiee',
      'yes',
      'yesss',
      'sure',
      'go ahead',
      'sounds good',
      'yes please',
    ]) {
      const d = aiCostRouteForUserMessage({ userText, conversationContext: ctx });
      expect(d.route).toBe('call_model');
    }
  });

  it('treats elongated ack typos as acknowledgements', () => {
    for (const userText of ['okayy', 'okiee', 'coolll']) {
      const d = aiCostRouteForUserMessage({ userText });
      expect(d.route).toBe('bypass_model');
      if (d.route === 'bypass_model') expect(d.reason).toBe('acknowledgement');
    }
  });

  it('does not loose-match unrelated words', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'book',
      conversationContext: {
        hasRecentSubstantiveAssistant: true,
        assistantAwaitingUserReply: true,
      },
    });
    expect(d.route).not.toBe('call_model');
  });

  it('does not substring-match acknowledgement stems inside longer phrases', () => {
    const d = aiCostRouteForUserMessage({ userText: 'i seek help' });
    expect(d.route).toBe('call_model');
  });

  it('calls model when user declines an assistant prompt', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'not now',
      conversationContext: {
        hasRecentSubstantiveAssistant: true,
        assistantAwaitingUserReply: true,
      },
    });
    expect(d.route).toBe('call_model');
  });

  it('routes roadmap confirmation end-to-end from message history', () => {
    const ctx = deriveConversationContext([
      {
        role: 'assistant',
        content: {
          text: 'I can build a 7-day practice plan for SQL interviews. Want me to generate it now?',
        },
      },
    ]);
    expect(ctx.assistantAwaitingUserReply).toBe(true);

    const d = aiCostRouteForUserMessage({
      userText: 'okay',
      conversationContext: ctx,
    });
    expect(d.route).toBe('call_model');
  });

  it('bypasses greeting', () => {
    const d = aiCostRouteForUserMessage({ userText: 'hey' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') {
      expect(d.reason).toBe('greeting');
      expect(d.replyText.toLowerCase()).toContain('hey');
    }
  });

  it('bypasses thanks', () => {
    const d = aiCostRouteForUserMessage({ userText: 'thanks' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') {
      expect(d.reason).toBe('thanks');
      expect(d.replyText.toLowerCase()).toContain("you're welcome");
    }
  });

  it('bypasses empty', () => {
    const d = aiCostRouteForUserMessage({ userText: '   ' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('empty');
  });

  it('bypasses too short cold start when not acknowledgement', () => {
    const d = aiCostRouteForUserMessage({ userText: 'ab' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('too_short');
  });

  it('treats ok as acknowledgement cold start', () => {
    const d = aiCostRouteForUserMessage({ userText: 'ok' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('acknowledgement');
  });

  it('bypasses too vague', () => {
    const d = aiCostRouteForUserMessage({ userText: 'help' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('too_vague');
  });

  it('bypasses solo interrogative cold start', () => {
    const d = aiCostRouteForUserMessage({ userText: 'why?' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('too_vague');
  });

  it('calls model for real question', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'Explain Solana PDAs like I am new to Anchor.',
    });
    expect(d.route).toBe('call_model');
  });

  it('continuation prompts skip bypass', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'tell me more about that step',
      conversationContext: {
        hasRecentSubstantiveAssistant: true,
        assistantAwaitingUserReply: false,
      },
    });
    expect(d.route).toBe('call_model');
  });

  it('solo why after substantive hits model', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'why',
      conversationContext: {
        hasRecentSubstantiveAssistant: true,
        assistantAwaitingUserReply: false,
      },
    });
    expect(d.route).toBe('call_model');
  });

  it('help after substantive hits model', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'help',
      conversationContext: {
        hasRecentSubstantiveAssistant: true,
        assistantAwaitingUserReply: false,
      },
    });
    expect(d.route).toBe('call_model');
  });

  it('cool after substantive bypasses when assistant is not awaiting', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'cool',
      conversationContext: {
        hasRecentSubstantiveAssistant: true,
        assistantAwaitingUserReply: false,
      },
    });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('acknowledgement');
  });

  it('meta queries bypass cheaply', () => {
    const d = aiCostRouteForUserMessage({ userText: 'what can you do?' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('meta');
  });

  it('chitchat bypasses', () => {
    const d = aiCostRouteForUserMessage({ userText: 'lol' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('chitchat');
  });

  it('disables greeting bypass when router off', () => {
    process.env.AI_COST_ROUTER_ENABLED = 'false';
    const cfg = getAiCostRouterConfig();
    expect(cfg.enabled).toBe(false);
    const d = aiCostRouteForUserMessage({ userText: 'hey' });
    expect(d.route).toBe('call_model');
  });

  it('uses remote router service when configured', async () => {
    process.env.AI_COST_ROUTER_SERVICE_TOKEN = 'test-router-token';
    process.env.AI_COST_ROUTER_SERVICE_URL = 'https://ai-cost.edulearn.fun';

    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        route: 'bypass_model',
        reason: 'greeting',
        normalizedText: 'hey',
        replyText: 'remote hello',
      }),
    } as Response);

    const d = await routeAiCostForUserMessage({ userText: { text: 'hey' } });

    expect(d).toEqual({
      route: 'bypass_model',
      reason: 'greeting',
      normalizedText: 'hey',
      replyText: 'remote hello',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://ai-cost.edulearn.fun/v1/route',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-router-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('falls back to local router when remote router fails', async () => {
    process.env.AI_COST_ROUTER_SERVICE_TOKEN = 'test-router-token';
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const d = await routeAiCostForUserMessage({ userText: 'hey' });

    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('greeting');
  });
});
