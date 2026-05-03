import {
  aiCostRouteForUserMessage,
  normalizeUserText,
  getAiCostRouterConfig,
  deriveConversationContext,
  messageContentToPlainText,
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

    const shortAssist = deriveConversationContext([
      { role: 'assistant', content: { text: 'ok' } },
    ]);
    expect(shortAssist.hasRecentSubstantiveAssistant).toBe(false);

    const longAssist = deriveConversationContext([
      { role: 'assistant', content: { text: SUBST_BODY } },
    ]);
    expect(longAssist.hasRecentSubstantiveAssistant).toBe(true);
  });

  it('bypasses greeting', () => {
    const d = aiCostRouteForUserMessage({ userText: 'hey' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('greeting');
  });

  it('bypasses thanks', () => {
    const d = aiCostRouteForUserMessage({ userText: 'thanks' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('thanks');
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
      conversationContext: { hasRecentSubstantiveAssistant: true },
    });
    expect(d.route).toBe('call_model');
  });

  it('solo why after substantive hits model', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'why',
      conversationContext: { hasRecentSubstantiveAssistant: true },
    });
    expect(d.route).toBe('call_model');
  });

  it('help after substantive hits model', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'help',
      conversationContext: { hasRecentSubstantiveAssistant: true },
    });
    expect(d.route).toBe('call_model');
  });

  it('cool after substantive bypasses when follow-up enabled', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'cool',
      conversationContext: { hasRecentSubstantiveAssistant: true },
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
});
