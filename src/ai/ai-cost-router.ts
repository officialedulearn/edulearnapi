export type AiCostRouteReason =
  | 'greeting'
  | 'thanks'
  | 'empty'
  | 'too_short'
  | 'too_vague'
  | 'non_question';

export type AiCostRouteDecision =
  | {
      route: 'call_model';
    }
  | {
      route: 'bypass_model';
      reason: AiCostRouteReason;
      normalizedText: string;
      replyText: string;
    };

type RouterConfig = {
  enabled: boolean;
  minChars: number;
  minWords: number;
};

const DEFAULT_MIN_CHARS = 6;
const DEFAULT_MIN_WORDS = 2;

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'could',
  'do',
  'for',
  'from',
  'get',
  'give',
  'help',
  'hi',
  'how',
  'i',
  "i'm",
  'im',
  'in',
  'is',
  'it',
  'like',
  'me',
  'my',
  'of',
  'on',
  'please',
  'tell',
  'teach',
  'thanks',
  'thank',
  'that',
  'the',
  'this',
  'to',
  'u',
  'uh',
  'um',
  'what',
  'when',
  'where',
  'who',
  'why',
  'you',
  'your',
]);

const GREETINGS = new Set([
  'hi',
  'hey',
  'hello',
  'yo',
  'sup',
  'good morning',
  'good afternoon',
  'good evening',
]);

const THANKS = new Set([
  'thanks',
  'thank you',
  'thx',
  'ty',
  'appreciate it',
]);

  const VAGUE_PATTERNS: Array<RegExp> = [
    /^help$/,
    /^explain$/,
    /^explain this$/,
    /^teach me$/,
    /^tell me$/,
    /^tell me about$/,
    /^what is this$/,
    /^i don'?t understand$/,
    /^i dont understand$/,
  ];

const counters: Partial<Record<AiCostRouteReason, number>> = {};

export function getAiCostRouterConfig(): RouterConfig {
  const enabledRaw = String(process.env.AI_COST_ROUTER_ENABLED ?? 'true');
  const enabled = enabledRaw.toLowerCase() !== 'false' && enabledRaw !== '0';

  const minChars = parseInt(
    String(process.env.AI_COST_ROUTER_MIN_CHARS ?? DEFAULT_MIN_CHARS),
    10,
  );
  const minWords = parseInt(
    String(process.env.AI_COST_ROUTER_MIN_WORDS ?? DEFAULT_MIN_WORDS),
    10,
  );

  return {
    enabled,
    minChars: Number.isFinite(minChars) && minChars > 0 ? minChars : DEFAULT_MIN_CHARS,
    minWords: Number.isFinite(minWords) && minWords > 0 ? minWords : DEFAULT_MIN_WORDS,
  };
}

export function normalizeUserText(input: unknown): string {
  const raw = typeof input === 'string' ? input : '';
  // Keep this simple and predictable: trim + lowercase + collapse whitespace,
  // then strip leading/trailing punctuation/emojis.
  const collapsed = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return collapsed.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '').trim();
}

function hasTopicWord(normalized: string): boolean {
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.some((t) => {
    const clean = t.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
    if (clean.length < 4) return false;
    return !STOPWORDS.has(clean);
  });
}

function isGreeting(normalized: string): boolean {
  if (!normalized) return false;
  if (normalized.length > 20) return false;
  return GREETINGS.has(normalized);
}

function isThanks(normalized: string): boolean {
  if (!normalized) return false;
  if (normalized.length > 30) return false;
  return THANKS.has(normalized);
}

function isTooVague(normalized: string): boolean {
  if (!normalized) return false;
  const matches = VAGUE_PATTERNS.some((re) => re.test(normalized));
  if (!matches) return false;
  return !hasTopicWord(normalized);
}

export function aiCostRouteForUserMessage(params: {
  userText: unknown;
  config?: RouterConfig;
}): AiCostRouteDecision {
  const cfg = params.config ?? getAiCostRouterConfig();
  if (!cfg.enabled) return { route: 'call_model' };

  const normalized = normalizeUserText(params.userText);
  const words = normalized ? normalized.split(/\s+/).filter(Boolean) : [];

  if (!normalized) {
    return bypass('empty', normalized, cannedReply('empty'));
  }
  if (isGreeting(normalized)) {
    return bypass('greeting', normalized, cannedReply('greeting'));
  }
  if (isThanks(normalized)) {
    return bypass('thanks', normalized, cannedReply('thanks'));
  }

  if (isTooVague(normalized)) {
    return bypass('too_vague', normalized, cannedReply('too_vague'));
  }

  const hasQuestionMark = String(params.userText ?? '').includes('?');
  if (!hasQuestionMark) {
    if (normalized.length < cfg.minChars || words.length < cfg.minWords) {
      return bypass('too_short', normalized, cannedReply('too_short'));
    }
  } else {
    // If it *is* a question but extremely short / contentless, nudge for context.
    if (normalized.length < cfg.minChars || words.length < cfg.minWords) {
      return bypass('too_short', normalized, cannedReply('too_short'));
    }
  }

  return { route: 'call_model' };
}

function bypass(
  reason: AiCostRouteReason,
  normalizedText: string,
  replyText: string,
): AiCostRouteDecision {
  counters[reason] = (counters[reason] ?? 0) + 1;
  return { route: 'bypass_model', reason, normalizedText, replyText };
}

export function getAiCostRouterCounters() {
  return { ...counters };
}

function cannedReply(reason: AiCostRouteReason): string {
  // Keep it short (and cheap) while guiding users into a “good question”.
  if (reason === 'greeting' || reason === 'thanks') {
    return (
      "Hey! What are you studying right now?\n\n" +
      "Try one of these:\n" +
      "1) Explain Solana PDAs like I'm new to Anchor.\n" +
      '2) Quiz me on SPL tokens (10 questions, medium).\n' +
      '3) Build me a 7-day roadmap for DeFi basics with daily tasks.'
    );
  }

  if (reason === 'empty' || reason === 'too_short' || reason === 'too_vague' || reason === 'non_question') {
    return (
      'Tell me what you want to learn, and I’ll tailor it.\n\n' +
      'Reply with:\n' +
      '- Topic (what)\n' +
      '- Goal (why)\n' +
      '- Your level (new/beginner/intermediate)\n' +
      '- Format (explain/quiz/roadmap)\n\n' +
      "Examples:\n" +
      "1) Explain Solana PDAs like I'm new to Anchor.\n" +
      '2) Quiz me on SPL tokens (10 questions, medium).\n' +
      '3) Build me a 7-day roadmap for DeFi basics with daily tasks.'
    );
  }

  return (
    'Can you add a bit more detail so I can help?\n\n' +
    "Example: “Explain Solana PDAs like I'm new to Anchor.”"
  );
}
