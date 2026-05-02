import {
  aiCostRouteForUserMessage,
  normalizeUserText,
  getAiCostRouterConfig,
} from './ai-cost-router';

describe('ai-cost-router', () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...prevEnv };
    process.env.AI_COST_ROUTER_ENABLED = 'true';
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

  it('bypasses too short', () => {
    const d = aiCostRouteForUserMessage({ userText: 'ok' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('too_short');
  });

  it('bypasses too vague', () => {
    const d = aiCostRouteForUserMessage({ userText: 'help' });
    expect(d.route).toBe('bypass_model');
    if (d.route === 'bypass_model') expect(d.reason).toBe('too_vague');
  });

  it('calls model for real question', () => {
    const d = aiCostRouteForUserMessage({
      userText: 'Explain Solana PDAs like I am new to Anchor.',
    });
    expect(d.route).toBe('call_model');
  });

  it('can be disabled by env', () => {
    process.env.AI_COST_ROUTER_ENABLED = 'false';
    const cfg = getAiCostRouterConfig();
    expect(cfg.enabled).toBe(false);
    const d = aiCostRouteForUserMessage({ userText: 'hey' });
    expect(d.route).toBe('call_model');
  });
});
