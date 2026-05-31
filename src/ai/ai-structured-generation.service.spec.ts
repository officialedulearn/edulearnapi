jest.mock('src/auth/auth.service', () => ({
  AuthService: class AuthService {},
}));
jest.mock('./gemini-client.service', () => ({
  GeminiClientService: class GeminiClientService {},
}));
jest.mock('src/quizzes/quiz-generation-history', () => ({
  getRecentQuizGenerationHistory: jest.fn().mockResolvedValue([]),
}));

import { AiStructuredGenerationService } from './ai-structured-generation.service';

type GeneratedPublicQuizDeck = {
  title: string;
  description?: string;
  summary?: string;
  coveredConcepts?: string[];
  challengeProfile?: string;
  questions: {
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
  }[];
};

type StructuredServiceInternals = {
  parseGeneratedJsonObject(response: string): unknown;
  normalizePublicQuizDeck(
    parsed: unknown,
    questionCount: number,
  ): GeneratedPublicQuizDeck;
};

const buildQuestions = (count = 10): GeneratedPublicQuizDeck['questions'] =>
  [
    'How should an immutable borrow scope be shortened before a later mutation?',
    'Which design avoids holding two mutable references to the same vector?',
    'How can moving a String into a helper affect later ownership use?',
    'Which lifetime annotation best describes returning one borrowed input?',
    'How does iterator borrowing influence mutation inside a collection loop?',
    'Which refactor lets a struct method read one field and update another?',
    'How should a closure capture be changed when ownership is still needed?',
    'Which async borrowing issue appears when a reference crosses an await point?',
    'How can slice borrowing prevent resizing the original buffer?',
    'Which interior mutability choice fits shared ownership with runtime checks?',
  ].slice(0, count).map((question, index) => {
    const n = index + 1;
    return {
      question,
      options: [`Option A${n}`, `Option B${n}`, `Option C${n}`, `Option D${n}`],
      correctAnswer: `Option A${n}`,
      explanation: `Explanation ${n}`,
    };
  });

const buildDeck = (count = 10): GeneratedPublicQuizDeck => ({
  title: 'Rust Borrow Checker Applications',
  description: 'Applied Rust ownership and borrowing scenarios.',
  summary: 'Tests Rust borrow checker reasoning across practical cases.',
  coveredConcepts: ['borrowing', 'lifetimes', 'mutability'],
  challengeProfile: 'Medium application and edge cases',
  questions: buildQuestions(count),
});

describe('AiStructuredGenerationService public quiz parsing', () => {
  let service: AiStructuredGenerationService;
  let internals: StructuredServiceInternals;
  let generateContentMock: jest.Mock;
  const authServiceMock = {
    getUserById: jest.fn().mockResolvedValue({
      id: 'u1',
      isPremium: false,
    }),
  };

  beforeEach(() => {
    generateContentMock = jest.fn();
    const geminiClientMock = {
      genAI: {
        models: {
          generateContent: generateContentMock,
        },
      },
    };
    service = new AiStructuredGenerationService(
      geminiClientMock as never,
      authServiceMock as never,
    );
    internals = service as unknown as StructuredServiceInternals;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('extracts and normalizes fenced or prose-wrapped quiz JSON', () => {
    const rawDeck = buildDeck(5);
    rawDeck.questions[0] = {
      ...rawDeck.questions[0],
      correctAnswer: 'A',
    };
    const response = [
      'Here is the quiz:',
      '```json',
      `${JSON.stringify(rawDeck)},`,
      '```',
      'Done.',
    ].join('\n');

    const parsed = internals.parseGeneratedJsonObject(response);
    const normalized = internals.normalizePublicQuizDeck(parsed, 5);

    expect(normalized.title).toBe(rawDeck.title);
    expect(normalized.questions).toHaveLength(5);
    expect(normalized.questions[0].correctAnswer).toBe('Option A1');
  });

  it('unwraps nested quiz payloads and slices extra valid questions', () => {
    const rawDeck = buildDeck(10);
    const nestedResponse = {
      quiz: {
        quizTitle: rawDeck.title,
        summary: rawDeck.summary,
        coveredConcepts: rawDeck.coveredConcepts,
        challengeProfile: rawDeck.challengeProfile,
        quizQuestions: [
          ...rawDeck.questions.map((question, index) => ({
            stem: question.question,
            choices: question.options.map((option) => ({ text: option })),
            correct_answer: `${(index % 4) + 1}`,
            rationale: question.explanation,
          })),
          {
            stem: 'Which extra question should be ignored?',
            choices: ['Extra A', 'Extra B', 'Extra C', 'Extra D'],
            correct_answer: 'Extra A',
            rationale: 'Extra explanation',
          },
        ],
      },
    };

    const normalized = internals.normalizePublicQuizDeck(nestedResponse, 10);

    expect(normalized.title).toBe(rawDeck.title);
    expect(normalized.questions).toHaveLength(10);
    expect(normalized.questions[2].correctAnswer).toBe('Option C3');
  });

  it('normalizes object-style options and synthesizes missing explanations', () => {
    const rawDeck = buildDeck(10);
    const objectStylePayload = {
      quizTitle: rawDeck.title,
      questions: rawDeck.questions.map((question) => ({
        questionText: question.question,
        options: {
          A: question.options[0],
          B: question.options[1],
          C: question.options[2],
          D: question.options[3],
        },
        correctOption: 'A',
      })),
    };

    const normalized = internals.normalizePublicQuizDeck(objectStylePayload, 10);

    expect(normalized.questions).toHaveLength(10);
    expect(normalized.questions[0]).toEqual({
      question: rawDeck.questions[0].question,
      options: rawDeck.questions[0].options,
      correctAnswer: rawDeck.questions[0].correctAnswer,
      explanation: `The correct answer is ${rawDeck.questions[0].correctAnswer}.`,
    });
  });

  it('detects correct answers from answer objects marked correct', () => {
    const rawDeck = buildDeck(10);
    const answerObjectPayload = {
      title: rawDeck.title,
      questions: rawDeck.questions.map((question) => ({
        prompt: question.question,
        answers: question.options.map((option) => ({
          label: option,
          isCorrect: option === question.correctAnswer,
        })),
        feedback: question.explanation,
      })),
    };

    const normalized = internals.normalizePublicQuizDeck(answerObjectPayload, 10);

    expect(normalized.questions).toHaveLength(10);
    expect(normalized.questions[4].correctAnswer).toBe('Option A5');
  });

  it('retries public quiz generation after malformed JSON and succeeds', async () => {
    const validDeck = buildDeck();
    const validResponse = JSON.stringify(validDeck);
    const malformedResponse = validResponse.replace(
      '"summary":"Tests Rust borrow checker reasoning across practical cases."',
      '"summary":"Tests "Rust" borrow checker reasoning."',
    );

    generateContentMock
      .mockResolvedValueOnce({ text: malformedResponse })
      .mockResolvedValueOnce({ text: validResponse });

    const result = await service.generatePublicQuizDeckContent(
      'u1',
      'Rust Borrow Checkers',
      10,
    );

    expect(generateContentMock).toHaveBeenCalledTimes(2);
    expect(result.title).toBe(validDeck.title);
    expect(result.questions).toEqual(validDeck.questions);
  });
});
