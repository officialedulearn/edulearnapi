export type QuizQuestionLike = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

export type QuizGenerationMetadata = {
  summary: string;
  coveredConcepts: string[];
  challengeProfile: string;
};

export type QuizGenerationHistoryItem = {
  title: string;
  summary: string | null;
  coveredConcepts: string[];
  challengeProfile: string | null;
  questions: QuizQuestionLike[];
};

export type QuizDiversityValidationResult =
  | { ok: true }
  | { ok: false; feedback: string };

const BASIC_RECALL_PATTERNS = [
  /^what\s+is\s+/i,
  /^what\s+are\s+/i,
  /^which\s+of\s+the\s+following\s+is\s+the\s+definition\s+of/i,
  /^which\s+statement\s+best\s+defines\s+/i,
  /^define\s+/i,
];

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'what',
  'when',
  'where',
  'which',
  'why',
  'with',
]);

export function normalizeQuestionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): Set<string> {
  const tokens = normalizeQuestionText(value)
    .split(' ')
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

function jaccardSimilarity(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection++;
  }
  return intersection / (left.size + right.size - intersection);
}

function isBasicRecallQuestion(question: string): boolean {
  return BASIC_RECALL_PATTERNS.some((pattern) => pattern.test(question.trim()));
}

export function buildQuizMetadataFromQuestions(
  title: string,
  questions: QuizQuestionLike[],
  difficulty?: 'easy' | 'medium' | 'hard',
): QuizGenerationMetadata {
  const conceptCounts = new Map<string, number>();
  for (const q of questions) {
    for (const token of tokenize(`${q.question} ${q.correctAnswer}`)) {
      conceptCounts.set(token, (conceptCounts.get(token) ?? 0) + 1);
    }
  }
  const coveredConcepts = [...conceptCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([concept]) => concept);
  const recallCount = questions.filter((q) =>
    isBasicRecallQuestion(q.question),
  ).length;
  const challengeProfile =
    difficulty === 'hard'
      ? 'Hard reasoning, edge cases, comparison, and synthesis'
      : difficulty === 'medium'
        ? 'Medium application and conceptual understanding'
        : difficulty === 'easy'
          ? 'Easy recall and basic understanding'
          : recallCount > questions.length / 2
            ? 'Recall-heavy quiz'
            : 'Mixed application and conceptual understanding';
  return {
    summary: `${title} covers ${coveredConcepts.slice(0, 5).join(', ') || 'the requested topic'} across ${questions.length} questions.`,
    coveredConcepts,
    challengeProfile,
  };
}

export function validateQuizDiversity(params: {
  questions: QuizQuestionLike[];
  history?: QuizGenerationHistoryItem[];
  difficulty?: 'easy' | 'medium' | 'hard';
  similarityThreshold?: number;
}): QuizDiversityValidationResult {
  const {
    questions,
    history = [],
    difficulty,
    similarityThreshold = 0.72,
  } = params;
  const feedback: string[] = [];
  const normalizedSeen = new Map<string, number>();

  for (let i = 0; i < questions.length; i++) {
    const normalized = normalizeQuestionText(questions[i].question);
    if (normalizedSeen.has(normalized)) {
      feedback.push(
        `Question ${i + 1} repeats question ${normalizedSeen.get(normalized)! + 1}.`,
      );
    }
    normalizedSeen.set(normalized, i);

    for (let j = 0; j < i; j++) {
      const similarity = jaccardSimilarity(
        questions[i].question,
        questions[j].question,
      );
      if (similarity >= similarityThreshold) {
        feedback.push(
          `Question ${i + 1} is too similar to question ${j + 1}.`,
        );
      }
    }
  }

  const priorQuestions = history.flatMap((item) => item.questions);
  for (let i = 0; i < questions.length; i++) {
    const match = priorQuestions.find((prior) => {
      const exact =
        normalizeQuestionText(prior.question) ===
        normalizeQuestionText(questions[i].question);
      return (
        exact ||
        jaccardSimilarity(prior.question, questions[i].question) >=
          similarityThreshold
      );
    });
    if (match) {
      feedback.push(
        `Question ${i + 1} repeats prior coverage: "${match.question.slice(0, 120)}".`,
      );
    }
  }

  if (difficulty === 'medium' || difficulty === 'hard') {
    const recallCount = questions.filter((q) =>
      isBasicRecallQuestion(q.question),
    ).length;
    const maxRecall = difficulty === 'hard' ? 2 : 4;
    if (recallCount > maxRecall) {
      feedback.push(
        `${difficulty} quizzes can include at most ${maxRecall} basic definition questions; generated ${recallCount}.`,
      );
    }
  }

  const priorConcepts = new Set(
    history.flatMap((item) =>
      item.coveredConcepts.map((concept) => normalizeQuestionText(concept)),
    ),
  );
  if (priorConcepts.size > 0) {
    const generatedConcepts = buildQuizMetadataFromQuestions(
      'Generated quiz',
      questions,
      difficulty,
    ).coveredConcepts.map((concept) => normalizeQuestionText(concept));
    const repeated = generatedConcepts.filter((concept) =>
      priorConcepts.has(concept),
    );
    if (repeated.length > Math.max(4, generatedConcepts.length / 2)) {
      feedback.push(
        `Generated concepts overlap too much with recent quizzes: ${repeated.slice(0, 8).join(', ')}.`,
      );
    }
  }

  if (feedback.length > 0) {
    return { ok: false, feedback: feedback.slice(0, 8).join(' ') };
  }
  return { ok: true };
}

export function formatQuizHistoryForPrompt(
  history: QuizGenerationHistoryItem[],
): string {
  if (!history.length) return '(none)';
  return history
    .slice(0, 10)
    .map((item, index) => {
      const concepts = item.coveredConcepts.slice(0, 8).join(', ') || 'none';
      const questions = item.questions
        .slice(0, 10)
        .map((q) => `- ${q.question}`)
        .join('\n');
      return [
        `Recent quiz ${index + 1}: ${item.title}`,
        `Summary: ${item.summary || '(none)'}`,
        `Concepts: ${concepts}`,
        `Challenge profile: ${item.challengeProfile || '(none)'}`,
        `Questions to avoid repeating:\n${questions}`,
      ].join('\n');
    })
    .join('\n\n');
}
