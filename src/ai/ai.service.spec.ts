import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { GeminiClientService } from './gemini-client.service';
import { QuizGenerationService } from './quiz-generation.service';
import { FlashcardService } from './flashcard.service';
import { SpeechTranscriptionService } from './speech-transcription.service';
import { ChatService } from 'src/chat/chat.service';
import { AuthService } from 'src/auth/auth.service';
import { RewardsService } from 'src/rewards/rewards.service';
import { RoadmapService } from 'src/roadmap/roadmap.service';
import { RedisService } from 'src/redis/redis.service';
import { QuizzesService } from 'src/quizzes/quizzes.service';

describe('AiService', () => {
  let service: AiService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: GeminiClientService,
          useValue: { genAI: { models: { generateContent: jest.fn() } } },
        },
        { provide: QuizGenerationService, useValue: {} },
        { provide: FlashcardService, useValue: {} },
        { provide: QuizzesService, useValue: {} },
        { provide: SpeechTranscriptionService, useValue: {} },
        { provide: ChatService, useValue: {} },
        { provide: AuthService, useValue: {} },
        { provide: RewardsService, useValue: {} },
        { provide: RoadmapService, useValue: {} },
        {
          provide: RedisService,
          useValue: {
            getStudySuggestionsPayload: jest.fn(),
            setStudySuggestionsPayload: jest.fn(),
            getStudySuggestionsTtlSeconds: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AiService>(AiService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
