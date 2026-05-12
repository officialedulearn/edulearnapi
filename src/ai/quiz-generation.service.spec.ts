jest.mock('src/auth/auth.service', () => ({
  AuthService: class AuthService {},
}));
jest.mock('src/chat/chat.service', () => ({
  ChatService: class ChatService {},
}));
jest.mock('./gemini-client.service', () => ({
  GeminiClientService: class GeminiClientService {},
}));

import { QuizGenerationService } from './quiz-generation.service';

type QuizQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

const buildQuestions = (): QuizQuestion[] =>
  Array.from({ length: 10 }, (_, index) => {
    const n = index + 1;
    return {
      question: `Question ${n}`,
      options: [
        `Option A${n}`,
        `Option B${n}`,
        `Option C${n}`,
        `Option D${n}`,
      ],
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
    const validResponse = JSON.stringify(expectedQuestions);
    const malformedResponse = validResponse.replace(
      '"question":"Question 1"',
      '"question":"Question "1"',
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
    expect(authServiceMock.getUserById).toHaveBeenCalledTimes(2);
    expect(authServiceMock.deductUserCredits).toHaveBeenCalledTimes(1);
    expect(authServiceMock.deductUserCredits).toHaveBeenCalledWith('u1');
    expect(result).toEqual(expectedQuestions);
  });
});
