jest.mock('src/auth/auth.service', () => ({
  AuthService: class AuthService {},
}));
jest.mock('src/chat/chat.service', () => ({
  ChatService: class ChatService {},
}));
jest.mock('./gemini-client.service', () => ({
  GeminiClientService: class GeminiClientService {},
}));
jest.mock('src/quizzes/quiz-generation-history', () => ({
  getRecentQuizGenerationHistory: jest.fn().mockResolvedValue([
    {
      title: 'Prior Solana quiz',
      summary: 'Covered basic Solana account definitions.',
      coveredConcepts: ['accounts', 'ownership'],
      challengeProfile: 'Recall',
      questions: [
        {
          question: 'What is a Solana account?',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 'A',
          explanation: 'Prior explanation',
        },
      ],
    },
  ]),
}));

import { QuizGenerationService } from './quiz-generation.service';

type QuizQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

const buildQuestions = (): QuizQuestion[] =>
  [
    'How should rent exemption affect account allocation planning?',
    'Which ownership rule matters when a program updates account data?',
    'What happens when a signer constraint is missing from a transfer flow?',
    'How can account data layout cause a deserialization failure?',
    'Which scenario best explains program derived address authority?',
    'How should a client handle stale blockhash transaction failures?',
    'Which comparison separates system accounts from token accounts?',
    'What edge case can break an instruction with unchecked accounts?',
    'How does compute budget pressure affect transaction design?',
    'Which validation prevents writing to the wrong user account?',
  ].map((question, index) => {
    const n = index + 1;
    return {
      question,
      options: [`Option A${n}`, `Option B${n}`, `Option C${n}`, `Option D${n}`],
      correctAnswer: `Option A${n}`,
      explanation: `Explanation ${n}`,
    };
  });

describe('QuizGenerationService', () => {
  let service: QuizGenerationService;
  let generateContentMock: jest.Mock;
  let authServiceMock: {
    getUserById: jest.Mock;
    deductUserCredits: jest.Mock;
  };

  beforeEach(() => {
    generateContentMock = jest.fn();
    authServiceMock = {
      getUserById: jest
        .fn()
        .mockResolvedValue({ id: 'u1', credits: 5, isPremium: false }),
      deductUserCredits: jest.fn().mockResolvedValue(undefined),
    };

    const geminiClientMock = {
      genAI: {
        models: {
          generateContent: generateContentMock,
        },
      },
    };

    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    service = new QuizGenerationService(
      geminiClientMock as never,
      {} as never,
      authServiceMock as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries scheduled quiz generation after malformed JSON and succeeds on next attempt', async () => {
    const expectedQuestions = buildQuestions();
    const validPayload = {
      summary: 'Tests Solana account behavior with applied scenarios.',
      coveredConcepts: ['rent', 'ownership', 'data layout'],
      challengeProfile: 'Medium application',
      questions: expectedQuestions,
    };
    const validResponse = JSON.stringify(validPayload);
    const malformedResponse = validResponse.replace(
      '"summary":"Tests Solana account behavior with applied scenarios."',
      '"summary":"Tests "Solana" account behavior."',
    );

    generateContentMock
      .mockResolvedValueOnce({ text: malformedResponse })
      .mockResolvedValueOnce({ text: validResponse });

    const result = await service.generateScheduledQuiz({
      userId: 'u1',
      topic: 'Solana basics',
      difficulty: 'medium',
      memoryContext: '',
    });

    expect(generateContentMock).toHaveBeenCalledTimes(2);
    expect(
      generateContentMock.mock.calls[0][0].contents,
    ).toContain('RECENT QUIZ HISTORY TO AVOID REPEATING');
    expect(
      generateContentMock.mock.calls[0][0].contents,
    ).toContain('Covered basic Solana account definitions.');
    expect(authServiceMock.getUserById).toHaveBeenCalledTimes(2);
    expect(authServiceMock.deductUserCredits).toHaveBeenCalledTimes(1);
    expect(authServiceMock.deductUserCredits).toHaveBeenCalledWith('u1');
    expect(result).toEqual(validPayload);
  });
});
