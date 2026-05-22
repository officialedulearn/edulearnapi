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
  assistantAwaitingUserReply: boolean;
};

type RouterConfig = {
  enabled: boolean;
  minChars: number;
  minWords: number;
  followupBypass: boolean;
};

type AiCostRouteParams = {
  userText: unknown;
  config?: RouterConfig;
  conversationContext?: AiCostConversationContext;
};

const DEFAULT_MIN_CHARS = 6;
const DEFAULT_MIN_WORDS = 2;
const DEFAULT_REMOTE_ROUTER_URL = 'https://ai-cost.edulearn.fun';
const DEFAULT_REMOTE_ROUTER_TIMEOUT_MS = 1500;

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

const AWAITING_PROMPT_PATTERNS: RegExp[] = [
  /\bwant me to\b/i,
  /\bshall i\b/i,
  /\bshould i\b/i,
  /\bwould you like(?: me)? to\b/i,
  /\bready for me to\b/i,
  /\bcan i (?:go ahead and )?(?:generate|create|build|make|start|schedule|quiz|set up|prepare)\b/i,
  /\b(?:go ahead|proceed|continue)\??\s*$/i,
  /\bsound good\??\s*$/i,
  /\bdoes that (?:work|sound good|make sense)\??\s*$/i,
  /\bis that ok(?:ay)?\??\s*$/i,
  /\blet me know if\b/i,
  /\bjust say (?:yes|ok|okay)\b/i,
  /\breply (?:with )?(?:yes|ok|okay)\b/i,
  /\b(?:want|like) (?:a|an|the|your) (?:roadmap|quiz|plan|schedule|flashcards?)\b/i,
  /\b(?:generate|create|build|make|start) (?:a|an|your|the) (?:roadmap|quiz|plan|schedule)\b/i,
  /\bwant (?:a|an|the|your) (?:roadmap|quiz|plan|schedule)\b/i,
  /\bconfirm(?: if)? i should\b/i,
];

const AWAITING_AFFIRMATION_EXACT = new Set([
  'ok',
  'okay',
  'k',
  'kk',
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'y',
  'yea',
  'please',
  'yes please',
  'go ahead',
  'do it',
  'sounds good',
  'sound good',
  'that works',
  "let's do it",
  'lets do it',
  'go for it',
  'why not',
  'absolutely',
  'definitely',
  'of course',
  'for sure',
  'okie',
  'aight',
  'alright',
  'all right',
  'correct',
  'right',
  'perfect',
  'great',
  'awesome',
  'cool',
  'nice',
  'sweet',
  'got it',
  'understood',
  'i see',
  'isee',
  'makes sense',
  'that makes sense',
  'will do',
  'copy that',
  'roger',
]);

const AWAITING_REJECTION_EXACT = new Set([
  'no',
  'nope',
  'nah',
  'not now',
  'not yet',
  'wait',
  'stop',
  'cancel',
  'never mind',
  'nevermind',
  'dont',
  "don't",
  'do not',
  'hold on',
  'not really',
]);

const LOOSE_PHRASE_MAX_EXTRA = 8;

const ACK_STEMS = [
  'that makes sense',
  'makes sense',
  'fair enough',
  'fair point',
  'all right',
  'okie dokie',
  'copy that',
  'got it',
  'i got it',
  'right on',
  'will do',
  'gotcha',
  'understood',
  'awesome',
  'perfect',
  'alright',
  'okay',
  'okie',
  'cool',
  'nice',
  'sweet',
  'great',
  'noted',
  'roger',
  'aight',
  'fire',
  'sick',
  'rad',
  'isee',
  'i see',
] as const;

const AWAITING_AFFIRMATION_STEMS = [
  'that makes sense',
  'makes sense',
  'sounds good',
  'sound good',
  "let's do it",
  'lets do it',
  'go ahead',
  'that works',
  'go for it',
  'of course',
  'for sure',
  'why not',
  'do it',
  'copy that',
  'got it',
  'will do',
  'understood',
  'absolutely',
  'definitely',
  'awesome',
  'perfect',
  'alright',
  'please',
  'okay',
  'okie',
  'yeah',
  'sure',
  'cool',
  'nice',
  'sweet',
  'great',
  'right',
  'yes',
  'yep',
  'yup',
  'yea',
  'roger',
  'aight',
  'isee',
  'i see',
] as const;

const AWAITING_REJECTION_STEMS = [
  'not really',
  'never mind',
  'nevermind',
  'not now',
  'not yet',
  'hold on',
  'do not',
  "don't",
  'dont',
  'cancel',
  'stop',
  'wait',
  'nope',
  'nah',
] as const;

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

function lastSignificantLine(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? text.trim();
}

function lastSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts[parts.length - 1]?.trim() ?? trimmed;
}

/** True when the last assistant turn expects yes/no or a short confirmation before proceeding. */
export function detectAssistantAwaitingUserReply(
  assistantText: string,
): boolean {
  const trimmed = assistantText.trim();
  if (!trimmed) return false;

  const tail = lastSentence(trimmed);
  const lastLine = lastSignificantLine(trimmed);
  const focus = tail.length <= 180 ? tail : lastLine;
  const endSlice = trimmed.slice(Math.max(0, trimmed.length - 240));

  if (AWAITING_PROMPT_PATTERNS.some((re) => re.test(focus))) return true;
  if (AWAITING_PROMPT_PATTERNS.some((re) => re.test(endSlice))) return true;

  if (
    /\?\s*$/.test(focus) &&
    /\b(you|your|me|i|we|us|shall|should|want|like|ready|may|can)\b/i.test(
      focus,
    )
  ) {
    return true;
  }

  return false;
}

function matchesShortOk(normalized: string): boolean {
  return /^ok+$/.test(normalized);
}

function matchesShortK(normalized: string): boolean {
  return /^k+$/.test(normalized) && normalized.length <= 4;
}

function matchesShortNo(normalized: string): boolean {
  return /^no+$/.test(normalized);
}

function looseTokenMatch(token: string, stem: string): boolean {
  if (token === stem) return true;
  if (!token.startsWith(stem)) return false;
  if (token.length > stem.length + LOOSE_PHRASE_MAX_EXTRA) return false;

  const extra = token.slice(stem.length);
  if (extra.length === 0) return true;

  const last = stem.at(-1);
  if (!last) return false;
  return [...extra].every((ch) => ch === last);
}

function matchesLooseStem(normalized: string, stem: string): boolean {
  const stemParts = stem.split(' ').filter(Boolean);
  const msgParts = normalized.split(' ').filter(Boolean);
  const maxLen = stem.length + LOOSE_PHRASE_MAX_EXTRA * stemParts.length;
  if (normalized.length > maxLen) return false;

  if (stemParts.length === 1) {
    if (msgParts.length !== 1) return false;
    return looseTokenMatch(msgParts[0], stemParts[0]);
  }

  if (msgParts.length !== stemParts.length) return false;
  return stemParts.every((part, idx) => looseTokenMatch(msgParts[idx], part));
}

function matchesLoosePhrase(
  normalized: string,
  exact: ReadonlySet<string>,
  stems: readonly string[],
  maxLen: number,
  tinyChecks: Array<(value: string) => boolean> = [],
): boolean {
  if (!normalized || normalized.length > maxLen) return false;
  if (exact.has(normalized)) return true;
  if (tinyChecks.some((check) => check(normalized))) return true;

  for (const stem of stems) {
    if (matchesLooseStem(normalized, stem)) return true;
  }
  return false;
}

function isAwaitingAffirmation(normalized: string): boolean {
  return matchesLoosePhrase(
    normalized,
    AWAITING_AFFIRMATION_EXACT,
    AWAITING_AFFIRMATION_STEMS,
    72,
    [matchesShortOk, matchesShortK],
  );
}

function isAwaitingRejection(normalized: string): boolean {
  return matchesLoosePhrase(
    normalized,
    AWAITING_REJECTION_EXACT,
    AWAITING_REJECTION_STEMS,
    72,
    [matchesShortNo],
  );
}

function shouldCallModelForAwaitingReply(
  normalized: string,
  ctx: AiCostConversationContext,
): boolean {
  if (!ctx.assistantAwaitingUserReply) return false;
  return isAwaitingAffirmation(normalized) || isAwaitingRejection(normalized);
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
    return {
      hasRecentSubstantiveAssistant: substantive,
      assistantAwaitingUserReply: detectAssistantAwaitingUserReply(trimmed),
    };
  }
  return {
    hasRecentSubstantiveAssistant: false,
    assistantAwaitingUserReply: false,
  };
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
  return matchesLoosePhrase(
    normalized,
    ACK_EXACT,
    ACK_STEMS,
    ACK_MAX_LEN,
    [matchesShortOk, matchesShortK],
  );
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
      assistantAwaitingUserReply: false,
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

  if (shouldCallModelForAwaitingReply(normalized, ctx)) {
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

export async function routeAiCostForUserMessage(
  params: AiCostRouteParams,
): Promise<AiCostRouteDecision> {
  const serviceEnabledRaw = String(
    process.env.AI_COST_ROUTER_SERVICE_ENABLED ?? 'true',
  );
  const serviceEnabled =
    serviceEnabledRaw.toLowerCase() !== 'false' && serviceEnabledRaw !== '0';
  const serviceToken = String(
    process.env.AI_COST_ROUTER_SERVICE_TOKEN ??
      process.env.INTERNAL_SERVICE_TOKEN ??
      '',
  ).trim();
  const serviceUrl = String(
    process.env.AI_COST_ROUTER_SERVICE_URL ?? DEFAULT_REMOTE_ROUTER_URL,
  ).trim();

  if (!serviceEnabled || !serviceToken || !serviceUrl) {
    return aiCostRouteForUserMessage(params);
  }

  const timeoutMsRaw = Number(process.env.AI_COST_ROUTER_SERVICE_TIMEOUT_MS);
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? timeoutMsRaw
      : DEFAULT_REMOTE_ROUTER_TIMEOUT_MS;

  try {
    const response = await fetch(`${serviceUrl.replace(/\/+$/, '')}/v1/route`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userText: messageContentToPlainText(params.userText),
        conversationContext:
          params.conversationContext ??
          ({
            hasRecentSubstantiveAssistant: false,
            assistantAwaitingUserReply: false,
          } satisfies AiCostConversationContext),
        config: params.config ?? getAiCostRouterConfig(),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`remote router returned HTTP ${response.status}`);
    }

    const decision = (await response.json()) as unknown;
    if (isAiCostRouteDecision(decision)) {
      return decision;
    }

    throw new Error('remote router returned invalid route decision');
  } catch (error) {
    console.warn('AI cost router service fallback:', error);
    return aiCostRouteForUserMessage(params);
  }
}

function isAiCostRouteDecision(value: unknown): value is AiCostRouteDecision {
  if (!value || typeof value !== 'object') return false;
  const route = (value as { route?: unknown }).route;
  if (route === 'call_model') return true;
  if (route !== 'bypass_model') return false;

  const bypass = value as {
    reason?: unknown;
    normalizedText?: unknown;
    replyText?: unknown;
  };
  return (
    typeof bypass.reason === 'string' &&
    typeof bypass.normalizedText === 'string' &&
    typeof bypass.replyText === 'string'
  );
}

type CannedKey = AiCostRouteReason | 'acknowledgement_followup';

function cannedReply(reason: CannedKey): string {
  if (reason === 'greeting') {
    return (
      "Hey 👋 What skill are you building today? Tell me what you're working on and whether you want " +
      'an explanation, a quiz, or a practice plan — e.g. "quiz me on TypeScript basics" or "7-day plan to get better at public speaking."'
    );
  }

  if (reason === 'thanks') {
    return "You're welcome 😊 Happy to keep going — what skill should we work on next?";
  }

  if (reason === 'chitchat') {
    return (
      "Haha fair 😄 Whenever you're ready, drop a skill you're building and what you need — " +
      'explain it, quiz me, or map out a practice plan.'
    );
  }

  if (reason === 'meta') {
    return (
      "I'm your EduLearn tutor 📚 I help you build real-world skills — explanations, quizzes, practice plans, " +
      "flashcards, and study schedules. Tell me which skill you're working on and how you want to practice, and we'll go from there."
    );
  }

  if (reason === 'acknowledgement_followup') {
    return (
      'Nice — want to go deeper on that skill? Ask something specific, or try ' +
      '"quiz me on React hooks" or "make me a week-long plan for SQL interviews."'
    );
  }

  if (reason === 'acknowledgement') {
    return 'Glad that helped 🙂 What skill should we level up next?';
  }

  if (reason === 'empty') {
    return (
      "Hmm, I didn't catch any text — mind sending it again? " +
      'Name the skill and whether you want an explanation, quiz, or practice plan.'
    );
  }

  if (reason === 'too_short') {
    return 'Hey 👋 What skill are you building today?';
  }

  if (reason === 'too_vague') {
    return (
      "I'd love to help — which skill are we working on, and do you want an explanation, quiz, or a practice plan? " +
      'Something like "explain async/await for beginners" or "quiz me on UX research basics" is perfect.'
    );
  }

  return (
    'Could you add a bit more detail? Something like "quiz me on Python data structures, medium difficulty" ' +
    'helps me give you a way better answer.'
  );
}
