import { createHash } from 'crypto';
import type { Message } from 'lib/db/schema';

export const MAX_MEMORY_CHARS = 500;
export const TUTOR_URL_PREFETCH_MAX_URLS = 3;
export const TUTOR_URL_FETCH_TIMEOUT_MS = 12_000;
export const TUTOR_URL_MAX_RESPONSE_BYTES = 400_000;
export const TUTOR_URL_MAX_CHARS_PER_PAGE = 12_000;
export const TUTOR_URL_MAX_TOTAL_EXTRA_CHARS = 28_000;
export const STUDY_SUGGESTIONS_TTL_SEC = 14 * 24 * 60 * 60;

export type StudySuggestionsRedisPayload = {
  suggestions: string[];
  generatedAt: string;
  feedback: Partial<Record<'0' | '1' | '2', 'up' | 'down'>>;
};

export const normalizeMemoryFactLine = (raw: string) =>
  raw.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

export const mergeMemoryDeduped = (
  existing: string,
  newFacts: string[],
  maxChars: number,
) => {
  const seen = new Set<string>();
  const lines: string[] = [];
  const add = (s: string) => {
    const n = normalizeMemoryFactLine(s);
    if (n.length < 4) return;
    const key = n.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(n);
  };
  for (const line of existing.split('\n')) add(line);
  for (const f of newFacts) add(f);
  while (lines.join('\n').length > maxChars && lines.length > 1) lines.shift();
  let out = lines.join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars).trimEnd();
  return out;
};

export const formatMessageText = (msg: {
  content: unknown;
}): string => {
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (
    c &&
    typeof c === 'object' &&
    'text' in c &&
    typeof (c as { text?: unknown }).text === 'string'
  )
    return (c as { text: string }).text;
  if (c && typeof c === 'object') return JSON.stringify(c);
  return String(c ?? '');
};

export type SanitizedAssistantText = {
  text: string;
  leakedMemoryFacts: string[];
};

const unwrapJsonTextPayload = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return raw;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { text?: unknown }).text === 'string'
    ) {
      return (parsed as { text: string }).text;
    }
  } catch {
    /* not a JSON text wrapper */
  }

  return raw;
};

const unescapeQuotedToolString = (raw: string) =>
  raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');

export const extractLeakedUpdateUserMemoryFacts = (raw: string): string[] => {
  const facts: string[] = [];
  const calls =
    raw.matchAll(
      /default_api\.updateUserMemory\s*\(\s*facts\s*=\s*\[([\s\S]*?)\]\s*\)/g,
    );

  for (const call of calls) {
    const list = call[1] ?? '';
    const quotedFacts = list.matchAll(/(['"])((?:\\.|(?!\1)[\s\S])*)\1/g);
    for (const fact of quotedFacts) {
      const normalized = normalizeMemoryFactLine(
        unescapeQuotedToolString(fact[2] ?? ''),
      );
      if (normalized) facts.push(normalized);
    }
  }

  return facts;
};

const extractUserFacingTextAfterThought = (raw: string): string => {
  const thoughtMatch = /(?:^|\n)\s*thought\s*\n/i.exec(raw);
  if (!thoughtMatch) return raw;

  const afterThought = raw
    .slice(thoughtMatch.index + thoughtMatch[0].length)
    .trim();
  if (!afterThought) return '';

  const responseCue =
    /(?:^|[.!?]\s+)(That's|That is|Awesome|Great|Nice|Absolutely|Sure|Got it|Yes|No|Thanks|You're|You are|As a|Let's|We can|Here(?:'s| is)|To help|For\b|In\b)\b/i;
  const cue = responseCue.exec(afterThought);
  if (cue?.index !== undefined) {
    return afterThought.slice(cue.index).replace(/^[.!?]\s*/, '').trim();
  }

  return afterThought;
};

export const sanitizeLeakedAssistantToolTranscript = (
  raw: string,
): SanitizedAssistantText => {
  const unwrapped = unwrapJsonTextPayload(raw);
  const leakedMemoryFacts = extractLeakedUpdateUserMemoryFacts(unwrapped);

  if (!/\btool_code\b/i.test(unwrapped) && !/\bthought\b/i.test(unwrapped)) {
    return { text: unwrapped.trim(), leakedMemoryFacts };
  }

  let text = unwrapped.replace(
    /(?:^|\n)\s*tool_code\s*\n[\s\S]*?(?=(?:^|\n)\s*thought\s*\n|$)/i,
    '\n',
  );
  text = extractUserFacingTextAfterThought(text);

  return {
    text: text.trim(),
    leakedMemoryFacts,
  };
};

export const sanitizeAssistantMessageContent = (content: unknown): unknown => {
  if (typeof content === 'string') {
    return sanitizeLeakedAssistantToolTranscript(content).text;
  }

  if (
    content &&
    typeof content === 'object' &&
    !Array.isArray(content) &&
    typeof (content as { text?: unknown }).text === 'string'
  ) {
    return {
      ...(content as Record<string, unknown>),
      text: sanitizeLeakedAssistantToolTranscript(
        (content as { text: string }).text,
      ).text,
    };
  }

  return content;
};

const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const isForbiddenUrlTarget = (url: URL) => {
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return true;
  const m = host.match(ipv4);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const c = Number(m[3]);
    const d = Number(m[4]);
    if ([a, b, c, d].some((n) => n > 255)) return true;
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
};

export const extractHttpUrlsFromText = (text: string, max: number) => {
  const re = /https?:\/\/[^\s<>)"']+/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null && out.length < max) {
    let raw = match[0].replace(/[.,;:!?)}\]]+$/u, '');
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (isForbiddenUrlTarget(url)) continue;
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    } catch {
      /* invalid */
    }
  }
  return out;
};

export const stripHtmlToPlainText = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, ' ')
    .trim();

export async function fetchUrlPlainTextForTutor(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TUTOR_URL_FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'EduLearn-Tutor/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (
      !ct.includes('text/html') &&
      !ct.includes('text/plain') &&
      !ct.includes('application/xhtml') &&
      !ct.includes('json') &&
      !ct.includes('xml')
    )
      return null;
    const buf = await res.arrayBuffer();
    const capped = buf.byteLength > TUTOR_URL_MAX_RESPONSE_BYTES ? buf.slice(0, TUTOR_URL_MAX_RESPONSE_BYTES) : buf;
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(capped);
    const text =
      ct.includes('html') || ct.includes('xhtml') ? stripHtmlToPlainText(raw) : raw.replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.length > TUTOR_URL_MAX_CHARS_PER_PAGE
      ? text.slice(0, TUTOR_URL_MAX_CHARS_PER_PAGE) + '\n[truncated]'
      : text;
  } catch {
    return null;
  }
}

export async function buildPrefetchedUrlContext(messageText: string): Promise<string | null> {
  const urls = extractHttpUrlsFromText(messageText, TUTOR_URL_PREFETCH_MAX_URLS);
  if (urls.length === 0) return null;
  const chunks: string[] = [];
  let anyOk = false;
  let totalLen = 0;
  for (const url of urls) {
    const body = await fetchUrlPlainTextForTutor(url);
    if (body) anyOk = true;
    const section = body ? `URL: ${url}\n${body}` : `URL: ${url}\n[Could not fetch this page.]`;
    if (totalLen + section.length > TUTOR_URL_MAX_TOTAL_EXTRA_CHARS) {
      chunks.push('[Further URL content omitted due to size limit.]');
      break;
    }
    totalLen += section.length;
    chunks.push(section);
  }
  if (!anyOk) return null;
  const header =
    '[Fetched web page text for URLs in the user message. May be incomplete; prefer it as reference only.]';
  return `${header}\n\n---\n\n${chunks.join('\n\n---\n\n')}`;
}

export const getXpTierFromXp = (xp: number) =>
  xp < 100 ? 'novice' : xp < 500 ? 'beginner' : xp < 1500 ? 'intermediate' : xp < 3000 ? 'advanced' : 'expert';

export const studySuggestionsFingerprint = (learning: string, userLevel: string, xpTier: string) =>
  createHash('sha256')
    .update(`${learning}|${userLevel}|${xpTier}`)
    .digest('hex')
    .slice(0, 16);

export const studySuggestionsRedisKey = (userId: string, fp: string) => `study_suggestions:${userId}:${fp}`;

export const parseStudySuggestionsCache = (raw: string): StudySuggestionsRedisPayload | null => {
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object') return null;
    const o = data as Record<string, unknown>;
    if (!Array.isArray(o.suggestions) || typeof o.generatedAt !== 'string') return null;
    const strings = o.suggestions.filter((x) => typeof x === 'string');
    if (strings.length < 3) return null;
    const feedback: StudySuggestionsRedisPayload['feedback'] = {};
    const fr = o.feedback;
    if (fr && typeof fr === 'object') {
      for (const k of ['0', '1', '2'] as const) {
        const v = (fr as Record<string, unknown>)[k];
        if (v === 'up' || v === 'down') feedback[k] = v;
      }
    }
    return {
      suggestions: strings.slice(0, 3) as string[],
      generatedAt: o.generatedAt,
      feedback,
    };
  } catch {
    return null;
  }
};

export const toGeminiMessageParts = (msg: { role: string; content: unknown }) => ({
  role: msg.role === 'assistant' ? ('model' as const) : ('user' as const),
  parts: toGeminiPartsFromContent(msg.content),
});

export type ChatAttachmentInput = {
  data: string;
  mimeType: string;
  name?: string;
  kind?: 'image' | 'document';
};

export type ChatMessageContentWithAttachments = {
  text?: string;
  attachments?: ChatAttachmentInput[];
};

export const getAttachmentsFromMessageContent = (
  content: unknown,
): ChatAttachmentInput[] => {
  if (!content || typeof content !== 'object') return [];
  const attachments = (content as ChatMessageContentWithAttachments).attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.filter(
    (a): a is ChatAttachmentInput =>
      Boolean(a) &&
      typeof a === 'object' &&
      typeof (a as ChatAttachmentInput).data === 'string' &&
      typeof (a as ChatAttachmentInput).mimeType === 'string' &&
      (typeof (a as ChatAttachmentInput).name === 'undefined' ||
        typeof (a as ChatAttachmentInput).name === 'string') &&
      (typeof (a as ChatAttachmentInput).kind === 'undefined' ||
        (a as ChatAttachmentInput).kind === 'image' ||
        (a as ChatAttachmentInput).kind === 'document'),
  );
};

export const toGeminiPartsFromContent = (content: unknown) => {
  // The Gemini SDK expects `parts` to be a list of objects with exactly one field set
  // (e.g. `text`, `inlineData`, `fileData`, ...). We only emit `text` + `inlineData`.
  if (typeof content === 'string') return [{ text: content }];

  if (Array.isArray(content)) {
    // Back-compat: OpenAI-style `{ type: 'text' | 'image_url', ... }` content arrays.
    const parts: Array<Record<string, unknown>> = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const it = item as Record<string, any>;
      if (it.type === 'text' && typeof it.text === 'string') {
        parts.push({ text: it.text });
        continue;
      }
      if (it.type === 'image_url' && it.image_url?.url) {
        // We don't fetch remote URLs in the server; include a hint as text.
        parts.push({ text: `Image URL: ${String(it.image_url.url)}` });
      }
    }
    return parts.length > 0 ? parts : [{ text: JSON.stringify(content) }];
  }

  if (content && typeof content === 'object') {
    const c = content as ChatMessageContentWithAttachments & Record<string, unknown>;
    const parts: Array<Record<string, unknown>> = [];
    if (typeof c.text === 'string' && c.text.trim().length > 0) {
      parts.push({ text: c.text });
    } else {
      const fallback = formatMessageText({ content });
      if (fallback) parts.push({ text: fallback });
    }

    const attachments = getAttachmentsFromMessageContent(content);
    for (const a of attachments) {
      parts.push({
        inlineData: {
          data: a.data,
          mimeType: a.mimeType,
        },
      });
    }

    return parts.length > 0 ? parts : [{ text: '' }];
  }

  return [{ text: String(content ?? '') }];
};
