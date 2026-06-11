export type ArtifactRenderer = 'native' | 'svg' | 'html';

export type ArtifactKind =
  | 'flowchart'
  | 'sequence'
  | 'comparison'
  | 'timeline'
  | 'conceptMap'
  | 'barChart'
  | 'lineChart'
  | 'pieChart'
  | 'metricCards'
  | 'table'
  | 'formulaSteps'
  | 'process'
  | 'quizExplainer'
  | 'svg'
  | 'html';

export type ChatArtifact = {
  id: string;
  kind: ArtifactKind;
  title: string;
  description?: string;
  version: number;
  renderer: ArtifactRenderer;
  data: Record<string, unknown>;
  fallbackText?: string;
  createdAt: string;
};

const ARTIFACT_KINDS = new Set<ArtifactKind>([
  'flowchart',
  'sequence',
  'comparison',
  'timeline',
  'conceptMap',
  'barChart',
  'lineChart',
  'pieChart',
  'metricCards',
  'table',
  'formulaSteps',
  'process',
  'quizExplainer',
  'svg',
  'html',
]);

const ARTIFACT_RENDERERS = new Set<ArtifactRenderer>([
  'native',
  'svg',
  'html',
]);

const MAX_ARTIFACTS_PER_MESSAGE = 4;
const MAX_MARKUP_CHARS = 20_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asString = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

const asVersion = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1;

const sanitizeArtifactData = (
  kind: ArtifactKind,
  data: unknown,
): Record<string, unknown> | null => {
  if (!isRecord(data)) return null;

  if (kind === 'html') {
    const html = asString(data.html).slice(0, MAX_MARKUP_CHARS);
    return html ? { html, allowScripts: data.allowScripts === true } : null;
  }

  if (kind === 'svg') {
    const markup = asString(data.markup).slice(0, MAX_MARKUP_CHARS);
    return markup ? { markup } : null;
  }

  return data;
};

const fallbackArtifactFromInvalid = (
  raw: Record<string, unknown>,
): ChatArtifact | null => {
  const fallbackText = asString(raw.fallbackText);
  if (!fallbackText) return null;

  return {
    id: asString(raw.id, `artifact-${Date.now()}`),
    kind: 'process',
    title: asString(raw.title, 'Generated visual'),
    description: asString(raw.description) || undefined,
    version: asVersion(raw.version),
    renderer: 'native',
    data: { steps: [] },
    fallbackText,
    createdAt: asString(raw.createdAt, new Date().toISOString()),
  };
};

export const normalizeChatArtifacts = (raw: unknown): ChatArtifact[] => {
  if (!Array.isArray(raw)) return [];

  return raw
    .slice(0, MAX_ARTIFACTS_PER_MESSAGE)
    .map((item): ChatArtifact | null => {
      if (!isRecord(item)) return null;
      const kind = item.kind;
      const renderer = item.renderer;
      if (
        !ARTIFACT_KINDS.has(kind as ArtifactKind) ||
        !ARTIFACT_RENDERERS.has(renderer as ArtifactRenderer)
      ) {
        return fallbackArtifactFromInvalid(item);
      }

      const data = sanitizeArtifactData(kind as ArtifactKind, item.data);
      if (!data) return fallbackArtifactFromInvalid(item);

      const id = asString(item.id);
      const title = asString(item.title, 'Generated visual');
      if (!id || !title) return fallbackArtifactFromInvalid(item);

      return {
        id,
        kind: kind as ArtifactKind,
        title,
        description: asString(item.description) || undefined,
        version: asVersion(item.version),
        renderer: renderer as ArtifactRenderer,
        data,
        fallbackText: asString(item.fallbackText) || undefined,
        createdAt: asString(item.createdAt, new Date().toISOString()),
      };
    })
    .filter((artifact): artifact is ChatArtifact => artifact !== null);
};
