import { Type } from '@google/genai';
import {
  Injectable,
  Inject,
  forwardRef,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { Message } from 'lib/db/schema';
import { AuthService } from 'src/auth/auth.service';
import { QuizGenerationService } from './quiz-generation.service';
import { FlashcardService } from './flashcard.service';
import { SpeechTranscriptionService } from './speech-transcription.service';
import { RedisService } from 'src/redis/redis.service';
import { GeminiClientService } from './gemini-client.service';
import { extractMemoryPrompt } from './prompts/extract-memory.prompt';
import type {
  GenerateSuggestionsDto,
  StudySuggestionsResponse,
  UpdateStudySuggestionFeedbackDto,
} from './dto/ai.dto';
import { UserService } from 'src/user/user.service';
import {
  MAX_MEMORY_CHARS,
  STUDY_SUGGESTIONS_TTL_SEC,
  formatMessageText,
  getXpTierFromXp,
  mergeMemoryDeduped,
  parseStudySuggestionsCache,
  studySuggestionsFingerprint,
  studySuggestionsRedisKey,
} from './ai.helpers';
import { AiStructuredGenerationService } from './ai-structured-generation.service';
import { AiTutorChatService } from './ai-tutor-chat.service';

@Injectable()
export class AiService {
  constructor(
    private readonly geminiClient: GeminiClientService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly quizGenerationService: QuizGenerationService,
    private readonly flashcardService: FlashcardService,
    private readonly speechTranscriptionService: SpeechTranscriptionService,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    private readonly redisService: RedisService,
    private readonly structured: AiStructuredGenerationService,
    @Inject(forwardRef(() => AiTutorChatService))
    private readonly tutor: AiTutorChatService,
  ) {}

  generateTitleFromMessage(m: Message) {
    return this.tutor.generateTitleFromMessage(m);
  }

  generateResponse(p: Parameters<AiTutorChatService['generateResponse']>[0]) {
    return this.tutor.generateResponse(p);
  }

  generateResponseStream(
    p: Parameters<AiTutorChatService['generateResponseStream']>[0],
  ) {
    return this.tutor.generateResponseStream(p);
  }

  async generateSuggestions(dto: GenerateSuggestionsDto): Promise<StudySuggestionsResponse> {
    const { userId, forceRefresh } = dto;
    const user = await this.authService.getUserById(userId);
    if (!user) throw new NotFoundException(`User with id ${userId} not found`);
    const xpTier = getXpTierFromXp(user.xp);
    const userLevel = user.level || xpTier;
    const userLearning = user.learning || 'blockchain fundamentals';
    const fp = studySuggestionsFingerprint(userLearning, userLevel, xpTier);
    const key = studySuggestionsRedisKey(userId, fp);
    if (!forceRefresh) {
      try {
        const raw = await this.redisService.getStudySuggestionsPayload(key);
        if (raw) {
          const cached = parseStudySuggestionsCache(raw);
          if (cached) {
            return {
              suggestions: cached.suggestions,
              generatedAt: cached.generatedAt,
              feedback: cached.feedback,
              fromCache: true,
            };
          }
        }
      } catch (e) {
        console.error('Study suggestions cache read failed:', e);
      }
    }
    const systemInstruction = `
You are EduLearn AI, a Web3 study assistant. 
Generate exactly 3 personalized study suggestions.

User:
- Interest: ${userLearning}
- Level: ${userLevel}
- XP: ${user.xp}
- Quizzes: ${user.quizCompleted}
- Streak: ${user.streak}

Rules:
- Match ${userLevel} level
- Build on ${userLearning}
- Tie to ICM, Solana, DeFi, NFTs, smart contracts, or Web3 tools
- Each suggestion: 3-5 words, study-focused, relevant, engaging
- Focus on understanding, not actions

YOU MUST ALWAYS GENERATE EXACTLY 3 SUGGESTIONS - NO MORE, NO LESS

Return ONLY valid JSON with no additional text.
`;
    try {
      const result = await this.geminiClient.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Generate 3 personalized learning suggestions for a ${userLevel} level user interested in ${userLearning} with ${user.xp} XP points.`,
        config: {
          maxOutputTokens: 2000,
          temperature: 0.7,
          systemInstruction: systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
              description: 'A short learning suggestion (3-5 words)',
            },
          },
        },
      });
      const responseText = result.text?.trim();
      if (!responseText) {
        console.error('Empty response from AI for suggestions');
        throw new Error('Empty response from AI');
      }
      const suggestions = JSON.parse(responseText);
      if (!Array.isArray(suggestions) || suggestions.length < 3) {
        throw new Error('Invalid suggestions format - expected array with 3 suggestions');
      }
      const three = suggestions.slice(0, 3) as string[];
      const generatedAt = new Date().toISOString();
      const payload = { suggestions: three, generatedAt, feedback: {} as const };
      try {
        await this.redisService.setStudySuggestionsPayload(
          key,
          STUDY_SUGGESTIONS_TTL_SEC,
          JSON.stringify(payload),
        );
      } catch (e) {
        console.error('Study suggestions cache write failed:', e);
      }
      return { suggestions: three, generatedAt, feedback: {}, fromCache: false };
    } catch (error) {
      console.error('Error generating suggestions:', error);
      const fallbackSuggestions = {
        novice: ['solana consensus basics', 'wallet security fundamentals', 'ICM market concepts'],
        beginner: ['anchor framework study', 'ICM trading principles', 'SPL token mechanics'],
        intermediate: ['solana PDA concepts', 'ICM protocol analysis', 'compute units explained'],
        advanced: ['ICM yield strategies', 'anchor optimization patterns', 'cross-program invocations'],
        expert: ['ICM protocol design', 'solana performance tuning', 'advanced ICM applications'],
      };
      const list = fallbackSuggestions[userLevel] || fallbackSuggestions.novice;
      return {
        suggestions: list,
        generatedAt: new Date().toISOString(),
        feedback: {},
        fromCache: false,
      };
    }
  }

  async extractMemoryAndSaveToDb(
    userId: string,
    messages: Message[],
  ): Promise<{ success: boolean; memory: string }> {
    const existingMemory = await this.userService.getUserMemory(userId);
    if (existingMemory.length >= MAX_MEMORY_CHARS) {
      return { success: true, memory: existingMemory };
    }
    const userLines = messages
      .filter((m) => m.role === 'user')
      .map((msg) => formatMessageText(msg).trim())
      .filter(Boolean);
    if (userLines.length === 0) return { success: true, memory: existingMemory };
    const transcript = userLines.map((t, i) => `${i + 1}. ${t}`).join('\n');
    try {
      const result = await this.geminiClient.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        config: {
          temperature: 0.2,
          maxOutputTokens: 512,
          systemInstruction: extractMemoryPrompt,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              facts: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING,
                  description:
                    'One short third-person fact about the learner; no markdown or filler',
                },
              },
            },
            required: ['facts'],
          },
        },
        contents: [
          { role: 'user', parts: [{ text: `User messages:\n${transcript}` }] },
        ],
      });
      const raw = result.text?.trim();
      if (!raw) return { success: true, memory: existingMemory };
      let facts: string[] = [];
      try {
        const parsed = JSON.parse(raw) as { facts?: unknown };
        if (Array.isArray(parsed.facts)) {
          facts = parsed.facts.filter((x) => typeof x === 'string') as string[];
        }
      } catch {
        return { success: true, memory: existingMemory };
      }
      if (facts.length === 0) return { success: true, memory: existingMemory };
      const merged = mergeMemoryDeduped(existingMemory, facts, MAX_MEMORY_CHARS);
      if (merged === existingMemory) return { success: true, memory: existingMemory };
      await this.userService.updateUserMemory(userId, merged);
      return { success: true, memory: merged };
    } catch (error) {
      console.error('Error extracting memory:', error);
      return { success: true, memory: existingMemory };
    }
  }

  async updateStudySuggestionFeedback(
    dto: UpdateStudySuggestionFeedbackDto,
  ): Promise<StudySuggestionsResponse> {
    const user = await this.authService.getUserById(dto.userId);
    if (!user) throw new NotFoundException(`User with id ${dto.userId} not found`);
    const xpTier = getXpTierFromXp(user.xp);
    const userLevel = user.level || xpTier;
    const userLearning = user.learning || 'blockchain fundamentals';
    const fp = studySuggestionsFingerprint(userLearning, userLevel, xpTier);
    const key = studySuggestionsRedisKey(dto.userId, fp);
    const raw = await this.redisService.getStudySuggestionsPayload(key);
    if (!raw) {
      throw new BadRequestException(
        'No cached study suggestions for this profile. Generate suggestions first.',
      );
    }
    const parsed = parseStudySuggestionsCache(raw);
    if (!parsed) throw new BadRequestException('Cached study suggestions are invalid.');
    const idx = String(dto.index) as '0' | '1' | '2';
    const next = {
      suggestions: parsed.suggestions,
      generatedAt: parsed.generatedAt,
      feedback: { ...parsed.feedback },
    };
    if (dto.action === 'none') delete next.feedback[idx];
    else next.feedback[idx] = dto.action;
    const ttlRaw = await this.redisService.getStudySuggestionsTtlSeconds(key);
    const ttlSec = ttlRaw > 0 ? ttlRaw : STUDY_SUGGESTIONS_TTL_SEC;
    await this.redisService.setStudySuggestionsPayload(key, ttlSec, JSON.stringify(next));
    return {
      suggestions: next.suggestions,
      generatedAt: next.generatedAt,
      feedback: next.feedback,
      fromCache: true,
    };
  }

  generateQuiz(params: { chatId: string; userId: string }) {
    return this.quizGenerationService.generateQuiz(params);
  }

  transcribeAudio(file: { path: string }) {
    return this.speechTranscriptionService.transcribeAudio(file);
  }

  transcribeAudioOnly(params: { file: { path: string } }) {
    return this.speechTranscriptionService.transcribeAudioOnly(params);
  }

  async generateFlashcards(dto: { userId: string; topic: string; cardCount?: number }) {
    const cardCount = dto.cardCount ?? 15;
    const parsed = await this.structured.generateFlashcardDeckContent(
      dto.userId,
      dto.topic,
      cardCount,
    );
    return this.flashcardService.saveFlashcardDeck({
      userId: dto.userId,
      topic: dto.topic.trim(),
      title: parsed.title,
      cards: parsed.cards,
    });
  }

  listFlashcardDecks(userId: string, limit?: number, offset?: number) {
    return this.flashcardService.listFlashcardDecks(userId, limit, offset);
  }

  getFlashcardDeckWithCards(userId: string, deckId: string) {
    return this.flashcardService.getFlashcardDeckWithCards(userId, deckId);
  }

  deleteFlashcardDeck(userId: string, deckId: string) {
    return this.flashcardService.deleteFlashcardDeck(userId, deckId);
  }
}
