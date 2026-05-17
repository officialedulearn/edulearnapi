import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

type StreamContent = {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
};

type Variant = {
  name: string;
  model: string;
  contents: StreamContent[];
  config: Record<string, unknown>;
};

type VariantResult = {
  name: string;
  model: string;
  estimatedPromptChars: number;
  estimatedPromptTokens: number;
  timeToFirstChunkMs: number | null;
  timeToFirstTextMs: number | null;
  totalCompletionMs: number;
  chunkCount: number;
  outputChars: number;
  error?: string;
};

const resolveEnvPath = (): string | null => {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'api/.env'),
    path.resolve(__dirname, '../.env'),
  ];
  const match = candidates.find((p) => existsSync(p));
  return match ?? null;
};

const envPath = resolveEnvPath();
if (envPath) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error('GEMINI_API_KEY is missing. Ensure it exists in .env.');
}

const genAI = new GoogleGenAI({ apiKey });

const parseTutorPromptTemplate = (): string => {
  const promptPath = path.resolve(
    __dirname,
    '../src/ai/prompts/tutor-system-prompt.ts',
  );
  if (!existsSync(promptPath)) {
    return 'You are EduLearn, a Web3 tutor. Teach clearly and concisely.';
  }
  const source = readFileSync(promptPath, 'utf8');
  const match = source.match(/return `([\s\S]*?)`;/);
  if (!match) {
    return 'You are EduLearn, a Web3 tutor. Teach clearly and concisely.';
  }
  return match[1].replace(/\$\{[^}]+\}/g, '<dynamic>');
};

const currentPromptTemplate = parseTutorPromptTemplate();

const syntheticMemory = [
  'Wants to transition from frontend to Solana development.',
  'Learns best with small coding drills and spaced repetition.',
  'Has basic TypeScript knowledge and beginner Rust knowledge.',
  'Can study for 45 minutes on weekdays and 2 hours on weekends.',
  'Wants to build a wallet-connected dApp portfolio project.',
].join('\n');

const fullSystemInstruction = `${currentPromptTemplate}\n\nLONG-TERM LEARNER MEMORY:\n${syntheticMemory}`;
const noMemorySystemInstruction = `${currentPromptTemplate}\n\nLONG-TERM LEARNER MEMORY:\n(none stored yet)`;

const mockTutorTools = [
  {
    name: 'scoreUser',
    description:
      'Award points when the learner answers a tutor question correctly.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        score: { type: Type.NUMBER, description: 'Integer score between 1-10' },
      },
      required: ['score'],
    },
  },
  {
    name: 'giveACertificate',
    description:
      'Award a certificate only when the learner demonstrates deep mastery.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        certificate: { type: Type.STRING },
        confidenceLevel: { type: Type.NUMBER },
        reasoning: { type: Type.STRING },
      },
      required: ['certificate', 'confidenceLevel', 'reasoning'],
    },
  },
  {
    name: 'createLearningRoadmap',
    description:
      'Create a personalized study roadmap when the learner explicitly asks for one.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING },
        userIntent: { type: Type.STRING },
      },
      required: ['topic', 'userIntent'],
    },
  },
  {
    name: 'createPublicQuiz',
    description:
      'Create and publish a multiple-choice quiz when explicitly requested.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING },
        userIntent: { type: Type.STRING },
        quizTitle: { type: Type.STRING },
        questionCount: { type: Type.NUMBER },
      },
      required: ['topic', 'userIntent'],
    },
  },
  {
    name: 'scheduleQuizGeneration',
    description:
      'Schedule recurring quiz generation with cron and timezone settings.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING },
        difficulty: { type: Type.STRING },
        cronExpression: { type: Type.STRING },
        timeZone: { type: Type.STRING },
      },
      required: ['topic', 'difficulty', 'cronExpression'],
    },
  },
  {
    name: 'createFlashcardDeck',
    description:
      'Create flashcards when learners ask for study cards or memorization cards.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: { type: Type.STRING },
        userIntent: { type: Type.STRING },
        cardCount: { type: Type.NUMBER },
      },
      required: ['topic', 'userIntent'],
    },
  },
  {
    name: 'editLearningRoadmap',
    description: 'Edit one or more roadmap steps based on user feedback.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        roadmapId: { type: Type.STRING },
        modifications: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              stepId: { type: Type.STRING },
              prompt: { type: Type.STRING },
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              time: { type: Type.NUMBER },
            },
            required: ['stepId', 'prompt', 'title', 'description', 'time'],
          },
        },
        changeReason: { type: Type.STRING },
      },
      required: ['roadmapId', 'modifications', 'changeReason'],
    },
  },
  {
    name: 'updateUserMemory',
    description: 'Store durable learner profile facts for future turns.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        facts: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['facts'],
    },
  },
];

const fullConversation: StreamContent[] = [
  {
    role: 'user',
    parts: [{ text: 'I want to become job-ready in Solana development.' }],
  },
  {
    role: 'model',
    parts: [
      {
        text: 'Great goal. We can focus on accounts, PDAs, CPIs, and wallet integration.',
      },
    ],
  },
  {
    role: 'user',
    parts: [{ text: 'Explain the account model with an example.' }],
  },
  {
    role: 'model',
    parts: [
      {
        text: 'Think of accounts as data containers and programs as pure logic executors.',
      },
    ],
  },
  {
    role: 'user',
    parts: [{ text: 'How should I practice PDA derivation and seeds?' }],
  },
  {
    role: 'model',
    parts: [
      {
        text: 'Use deterministic seeds from user ids, resource ids, and version markers.',
      },
    ],
  },
  {
    role: 'user',
    parts: [
      {
        text: 'I have 6 weeks. Build me a practical plan with milestones and mini-projects.',
      },
    ],
  },
  {
    role: 'model',
    parts: [
      {
        text: 'Week-by-week plans should increase from fundamentals to integration and debugging.',
      },
    ],
  },
  {
    role: 'user',
    parts: [
      {
        text: 'Also include CLI drills, failing test drills, and deployment checks for each week.',
      },
    ],
  },
];

const lastFiveMessages = fullConversation.slice(-5);

const toolsConfig = [{ functionDeclarations: mockTutorTools }];

const variants: Variant[] = [
  {
    name: 'full_current_prompt',
    model: 'gemini-2.5-flash',
    contents: fullConversation,
    config: {
      tools: toolsConfig,
      maxOutputTokens: 5000,
      temperature: 1,
      systemInstruction: fullSystemInstruction,
    },
  },
  {
    name: 'no_tools',
    model: 'gemini-2.5-flash',
    contents: fullConversation,
    config: {
      maxOutputTokens: 5000,
      temperature: 1,
      systemInstruction: fullSystemInstruction,
    },
  },
  {
    name: 'no_memory_context',
    model: 'gemini-2.5-flash',
    contents: fullConversation,
    config: {
      tools: toolsConfig,
      maxOutputTokens: 5000,
      temperature: 1,
      systemInstruction: noMemorySystemInstruction,
    },
  },
  {
    name: 'last_5_messages_only',
    model: 'gemini-2.5-flash',
    contents: lastFiveMessages,
    config: {
      tools: toolsConfig,
      maxOutputTokens: 5000,
      temperature: 1,
      systemInstruction: fullSystemInstruction,
    },
  },
  {
    name: 'fastest_flash_model',
    model: 'gemini-2.5-flash-lite',
    contents: fullConversation,
    config: {
      tools: toolsConfig,
      maxOutputTokens: 5000,
      temperature: 1,
      systemInstruction: fullSystemInstruction,
    },
  },
  {
    name: 'minimal_prompt',
    model: 'gemini-2.5-flash-lite',
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Explain Solana PDA in one sentence.' }],
      },
    ],
    config: {
      maxOutputTokens: 128,
      temperature: 0.2,
      systemInstruction: 'You are a concise technical tutor.',
    },
  },
];

const estimatePromptChars = (variant: Variant): number => {
  const config = variant.config ?? {};
  const systemInstruction =
    typeof config.systemInstruction === 'string' ? config.systemInstruction : '';
  const contentChars = variant.contents.reduce((sum, message) => {
    const partChars = message.parts.reduce((partSum, p) => partSum + p.text.length, 0);
    return sum + partChars;
  }, 0);
  const toolsChars = config.tools ? JSON.stringify(config.tools).length : 0;
  return systemInstruction.length + contentChars + toolsChars;
};

const extractChunkText = (chunk: any): string => {
  const parts = chunk?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part: any) => typeof part?.text === 'string')
    .map((part: any) => part.text)
    .join('');
};

const hrNow = () => process.hrtime.bigint();
const elapsedMs = (startHr: bigint) =>
  Number(process.hrtime.bigint() - startHr) / 1_000_000;

const runVariant = async (variant: Variant): Promise<VariantResult> => {
  const promptChars = estimatePromptChars(variant);
  const promptTokensApprox = Math.round(promptChars / 4);
  const startedHr = hrNow();
  let firstChunkMs: number | null = null;
  let firstTextMs: number | null = null;
  let chunkCount = 0;
  let outputChars = 0;

  try {
    const stream = await genAI.models.generateContentStream({
      model: variant.model,
      contents: variant.contents,
      config: variant.config,
    });

    for await (const chunk of stream) {
      chunkCount += 1;
      if (firstChunkMs === null) {
        firstChunkMs = elapsedMs(startedHr);
      }

      const text = extractChunkText(chunk);
      if (text.length > 0) {
        outputChars += text.length;
        if (firstTextMs === null) {
          firstTextMs = elapsedMs(startedHr);
        }
      }
    }

    return {
      name: variant.name,
      model: variant.model,
      estimatedPromptChars: promptChars,
      estimatedPromptTokens: promptTokensApprox,
      timeToFirstChunkMs: firstChunkMs,
      timeToFirstTextMs: firstTextMs,
      totalCompletionMs: elapsedMs(startedHr),
      chunkCount,
      outputChars,
    };
  } catch (error) {
    return {
      name: variant.name,
      model: variant.model,
      estimatedPromptChars: promptChars,
      estimatedPromptTokens: promptTokensApprox,
      timeToFirstChunkMs: firstChunkMs,
      timeToFirstTextMs: firstTextMs,
      totalCompletionMs: elapsedMs(startedHr),
      chunkCount,
      outputChars,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const formatMs = (value: number | null) =>
  value === null ? 'n/a' : `${value.toFixed(1)} ms`;

const main = async () => {
  console.log(
    `Gemini streaming latency benchmark\n- env: ${envPath ?? '(default dotenv resolution)'}\n- variants: ${variants.length}\n`,
  );

  const results: VariantResult[] = [];
  for (const variant of variants) {
    console.log(`Running ${variant.name} (${variant.model})...`);
    const result = await runVariant(variant);
    results.push(result);
    if (result.error) {
      console.log(`  ERROR: ${result.error}`);
    } else {
      console.log(
        `  firstChunk=${formatMs(result.timeToFirstChunkMs)} firstText=${formatMs(
          result.timeToFirstTextMs,
        )} total=${formatMs(result.totalCompletionMs)} prompt~${result.estimatedPromptTokens}t`,
      );
    }
  }

  console.log('\n=== Summary ===');
  const header = [
    'variant',
    'model',
    'promptTokens~',
    'ttfChunkMs',
    'ttfTextMs',
    'totalMs',
    'chunks',
    'error',
  ];
  console.log(header.join('\t'));

  for (const r of results) {
    console.log(
      [
        r.name,
        r.model,
        String(r.estimatedPromptTokens),
        r.timeToFirstChunkMs === null ? 'n/a' : r.timeToFirstChunkMs.toFixed(1),
        r.timeToFirstTextMs === null ? 'n/a' : r.timeToFirstTextMs.toFixed(1),
        r.totalCompletionMs.toFixed(1),
        String(r.chunkCount),
        r.error ?? '',
      ].join('\t'),
    );
  }
};

void main();
