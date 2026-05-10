export type AiCostRouteReason =
  | 'greeting'
  | 'thanks'
  | 'empty'
  | 'too_short'
  | 'too_vague'
  | 'chitchat'
  | 'acknowledgement'
  | 'meta';

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

export type AiCostConversationContext = {
  hasRecentSubstantiveAssistant: boolean;
};

type RouterConfig = {
  enabled: boolean;
  minChars: number;
  minWords: number;
  followupBypass: boolean;
};

const DEFAULT_MIN_CHARS = 6;
const DEFAULT_MIN_WORDS = 2;

/** Last assistant bubble before current user utterance counts as substantive for follow-up shortcuts. */
const SUBST_ASSIST_WORDS_MIN = 32;
const SUBST_ASSIST_CHARS_MIN = 220;

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

const GREETINGS_MAX_LEN = 48;
const GREETINGS = new Set([
  'hi',
  'hey',
  'hello',
  'yo',
  'sup',
  'gm',
  'gn',
  'wagmi',
  'good morning',
  'good afternoon',
  'good evening',
  'good night',
  'good day',
  'morning',
  'afternoon',
  'evening',
  'hola',
  'howdy',
  'greetings',
  'hey there',
  'hello there',
  'hi there',
]);

const THANKS_MAX_LEN = 72;
const THANKS = new Set([
  'thanks',
  'thank you',
  'thank you!',
  'thx',
  'ty',
  'ty!',
  'appreciate it',
  'much appreciated',
  'much obliged',
  'cheers',
  'you rock',
]);

const META_PATTERNS: RegExp[] = [
  /^what can you do\??$/,
  /^what do you do\??$/,
  /^who are you\??$/,
  /^how does this app work\??$/,
  /^how does this work\??$/,
  /^what is this (for|about)\??$/,
  /^what is edulearn\??$/,
  /^who made you\??$/,
];

const CHITCHAT_MAX_LEN = 56;
const CHITCHAT_EXACT = new Set([
  'lol',
  'lmao',
  'lolol',
  'haha',
  'hahaha',
  'hehe',
  'hehehe',
  'rofl',
  'bru',
  'bruh',
  'oof',
  'meh',
  'nm',
  'nvm',
  'relatable',
  'i am bored',
  "i'm bored",
  'im bored',
  'idc',
  'wtf',
]);

const ACK_MAX_LEN = 72;
const ACK_EXACT = new Set([
  'ok',
  'okay',
  'k',
  'kk',
  'okie',
  'okie dokie',
  'cool',
  'nice',
  'sweet',
  'great',
  'awesome',
  'perfect',
  'rad',
  'sick',
  'fire',
  'got it',
  'gotcha',
  'understood',
  'i see',
  'isee',
  'i got it',
  'makes sense',
  'that makes sense',
  'fair enough',
  'fair point',
  'right on',
  'noted',
  'roger',
  'copy that',
  'will do',
  'alright',
  'all right',
  'aight',
]);

const CONTINUATION_PATTERNS: RegExp[] = [
  /\b(go on|keep going|keep it going|tell me more|explain more|dig deeper|elaborate|give me another example)\b/i,
  /\b(more detail|more details)\b/i,
  /^(more|details|examples|another example|continue|continuation)\??$/i,
];

const SOLO_INTERROGATIVE = /^(why|how|what|when|where|who)(\?)?$/;

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

  const followRaw = String(process.env.AI_COST_ROUTER_FOLLOWUP ?? 'true');
  const followupBypass =
    followRaw.toLowerCase() !== 'false' && followRaw !== '0';

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
    followupBypass,
    minChars:
      Number.isFinite(minChars) && minChars > 0 ? minChars : DEFAULT_MIN_CHARS,
    minWords:
      Number.isFinite(minWords) && minWords > 0 ? minWords : DEFAULT_MIN_WORDS,
  };
}

/** Plaintext from stored message `content` JSON. */
export function messageContentToPlainText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const t = (content as Record<string, unknown>).text;
    if (typeof t === 'string') return t;
  }
  return '';
}

/** Context from persisted chat messages *before* the current user utterance is saved. */
export function deriveConversationContext(
  messages: Array<{ role: string; content: unknown }>,
): AiCostConversationContext {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue;
    const trimmed = messageContentToPlainText(messages[i].content).trim();
    if (!trimmed) continue;
    const words = trimmed.split(/\s+/).filter(Boolean);
    const multilineLift =
      trimmed.includes('\n\n') ||
      trimmed.split(/\n/).filter((l) => l.trim()).length >= 4;
    const substantive =
      words.length >= SUBST_ASSIST_WORDS_MIN ||
      trimmed.length >= SUBST_ASSIST_CHARS_MIN ||
      multilineLift;
    return { hasRecentSubstantiveAssistant: substantive };
  }
  return { hasRecentSubstantiveAssistant: false };
}

export function normalizeUserText(input: unknown): string {
  const raw = typeof input === 'string' ? input : '';
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

function looksLikeContinuationPrompt(normalized: string): boolean {
  return CONTINUATION_PATTERNS.some((re) => re.test(normalized));
}

function isMetaQuery(normalized: string): boolean {
  return META_PATTERNS.some((re) => re.test(normalized));
}

function isGreeting(normalized: string): boolean {
  if (!normalized || normalized.length > GREETINGS_MAX_LEN) return false;
  return GREETINGS.has(normalized);
}

function isThanks(normalized: string): boolean {
  if (!normalized || normalized.length > THANKS_MAX_LEN) return false;
  return THANKS.has(normalized);
}

function isChitchat(normalized: string): boolean {
  if (!normalized || normalized.length > CHITCHAT_MAX_LEN) return false;
  return CHITCHAT_EXACT.has(normalized);
}

function isStandaloneAcknowledgement(normalized: string): boolean {
  if (!normalized || normalized.length > ACK_MAX_LEN) return false;
  return ACK_EXACT.has(normalized);
}

function isTooVague(normalized: string): boolean {
  if (!normalized) return false;
  const matchesPattern = VAGUE_PATTERNS.some((re) => re.test(normalized));
  if (matchesPattern) return !hasTopicWord(normalized);
  if (SOLO_INTERROGATIVE.test(normalized)) return !hasTopicWord(normalized);
  return false;
}

/** After long tutor replies, stubs like “help” / solo “why” must reach the model, not cost-saving bypasses. */
function needsContinuationModel(
  normalized: string,
  ctx: AiCostConversationContext,
): boolean {
  if (!ctx.hasRecentSubstantiveAssistant) return false;
  if (SOLO_INTERROGATIVE.test(normalized)) return true;
  const vagueStem = VAGUE_PATTERNS.some((re) => re.test(normalized));
  if (vagueStem && !hasTopicWord(normalized)) return true;
  return false;
}

export function aiCostRouteForUserMessage(params: {
  userText: unknown;
  config?: RouterConfig;
  conversationContext?: AiCostConversationContext;
}): AiCostRouteDecision {
  const cfg = params.config ?? getAiCostRouterConfig();
  const ctx =
    params.conversationContext ??
    ({
      hasRecentSubstantiveAssistant: false,
    } satisfies AiCostConversationContext);

  if (!cfg.enabled) return { route: 'call_model' };

  const normalized = normalizeUserText(params.userText);

  const words = normalized ? normalized.split(/\s+/).filter(Boolean) : [];

  if (!normalized) {
    return bypass('empty', normalized, cannedReply('empty'));
  }

  if (looksLikeContinuationPrompt(normalized)) {
    return { route: 'call_model' };
  }

  if (needsContinuationModel(normalized, ctx)) {
    return { route: 'call_model' };
  }

  if (isMetaQuery(normalized)) {
    return bypass('meta', normalized, cannedReply('meta'));
  }

  if (isGreeting(normalized)) {
    return bypass('greeting', normalized, cannedReply('greeting'));
  }
  if (isThanks(normalized)) {
    return bypass('thanks', normalized, cannedReply('thanks'));
  }
  if (isChitchat(normalized)) {
    return bypass('chitchat', normalized, cannedReply('chitchat'));
  }

  if (isStandaloneAcknowledgement(normalized)) {
    const reply =
      cfg.followupBypass && ctx.hasRecentSubstantiveAssistant
        ? cannedReply('acknowledgement_followup')
        : cannedReply('acknowledgement');
    return bypass('acknowledgement', normalized, reply);
  }

  const vagueEligible =
    !ctx.hasRecentSubstantiveAssistant && isTooVague(normalized);
  if (vagueEligible) {
    return bypass('too_vague', normalized, cannedReply('too_vague'));
  }

  const hasQuestionMark = messageContentToPlainText(params.userText).includes(
    '?',
  );

  const shortBypass =
    normalized.length < cfg.minChars || words.length < cfg.minWords;

  if (!hasQuestionMark && shortBypass) {
    return bypass('too_short', normalized, cannedReply('too_short'));
  }
  if (hasQuestionMark && shortBypass) {
    return bypass('too_short', normalized, cannedReply('too_short'));
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

type CannedKey = AiCostRouteReason | 'acknowledgement_followup';

function cannedReply(reason: CannedKey): string {
  if (reason === 'greeting') {
    return (
      'Hey! What are you studying right now?\n\n' +
      'Try one of these:\n' +
      "1) Explain Solana PDAs like I'm new to Anchor.\n" +
      '2) Quiz me on SPL tokens (10 questions, medium).\n' +
      '3) Build me a 7-day roadmap for DeFi basics with daily tasks.'
    );
  }

  if (reason === 'thanks') {
    return (
      "You're welcome. Want to keep going?\n\n" +
      'Pick a format:\n' +
      '- Explain: "Explain <topic> at <level>."\n' +
      '- Quiz: "Quiz me on <topic> (N questions, difficulty)."\n' +
      '- Roadmap: "Make a <days>-day plan for <topic>."'
    );
  }

  if (reason === 'chitchat') {
    return (
      'We can keep chatting, but to save turn time hit me with a learning goal.\n\n' +
      'Examples:\n' +
      "1) Explain Solana PDAs like I'm new to Anchor.\n" +
      '2) Quiz me on SPL tokens (10 questions, medium).\n' +
      '3) Summarize EIP-4844 tradeoffs.'
    );
  }

  if (reason === 'meta') {
    return (
      "I'm your EduLearn tutor: explain tricky topics, quiz you, roadmap study plans, flashcards/schedules.\n\n" +
      'Pick one lane and stack context:\n' +
      '- Topic (what)\n' +
      '- Goal (exam? job? curiosity?)\n' +
      '- Level (new/intermediate/advanced)\n' +
      '- Format (explain / quiz / roadmap)\n'
    );
  }

  if (reason === 'acknowledgement_followup') {
    return (
      'Want to drill deeper? Reply with:\n' +
      '- One concrete question, or\n' +
      '- "Quiz me ..." / "Roadmap ..." with topic + timeframe.\n\n' +
      'Example: Compare PDAs vs program-derived addresses with a beginner-friendly analogy.'
    );
  }

  if (reason === 'acknowledgement') {
    return (
      'Glad that landed. What topic should we nail next?\n\n' +
      "Example: Explain Solana PDAs like I'm new to Anchor."
    );
  }

  if (reason === 'empty') {
    return (
      "I didn't catch any text there.\n\n" +
      'Send a topic + what you want:\n' +
      '- Explain / Quiz / Roadmap\n\n' +
      'Example: "Quiz me on SPL tokens (10 questions, medium)."'
    );
  }

  if (reason === 'too_short') {
    return (
     "Hi! What are you studying right now?"
    );
  }

  if (reason === 'too_vague') {
    return (
      'Help with what, specifically?\n\n' +
      'Reply with:\n' +
      '- Topic (e.g., "Solana PDAs")\n' +
      '- What you want (explain / quiz / roadmap)\n' +
      '- Your level\n\n' +
      'Example: "Explain Solana PDAs at a beginner level, step-by-step."'
    );
  }

  return (
    'Can you add a bit more detail so I can help?\n\n' +
    'Example: "Explain Solana PDAs like I\'m new to Anchor."'
  );
}
