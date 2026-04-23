import { Type } from '@google/genai';
import { createHash } from 'crypto';
import {
  Injectable,
  Inject,
  forwardRef,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { message, Message } from 'lib/db/schema';
import { getMostRecentUserMessage } from 'lib/utils';
import { AuthService } from 'src/auth/auth.service';
import { ChatService } from 'src/chat/chat.service';
import { generateUUID } from 'lib/utils';
import { RewardsService } from 'src/rewards/rewards.service';
import { RoadmapService } from 'src/roadmap/roadmap.service';
import { nftRewards } from './config/nft-rewards';
import { buildTutorSystemInstruction } from './prompts/tutor-system-prompt';
import { GEMINI_TUTOR_FUNCTION_DECLARATIONS } from './prompts/gemini-tools';
import { GeminiClientService } from './gemini-client.service';
import { QuizGenerationService } from './quiz-generation.service';
import { FlashcardService } from './flashcard.service';
import { QuizzesService } from 'src/quizzes/quizzes.service';
import { QuizScheduleService } from 'src/quizzes/quiz-schedule.service';
import { FLASHCARD_SYSTEM_INSTRUCTION } from './prompts/flashcard-system-prompt';
import { SpeechTranscriptionService } from './speech-transcription.service';
import { RedisService } from 'src/redis/redis.service';
import type {
  GenerateSuggestionsDto,
  StudySuggestionsResponse,
  UpdateStudySuggestionFeedbackDto,
} from './dto/ai.dto';
import { extractMemoryPrompt } from './prompts/extract-memory.prompt';
import { UserService } from 'src/user/user.service';
const MAX_MEMORY_CHARS = 500;

const STUDY_SUGGESTIONS_TTL_SEC = 14 * 24 * 60 * 60;

type StudySuggestionsRedisPayload = {
  suggestions: string[];
  generatedAt: string;
  feedback: Partial<Record<'0' | '1' | '2', 'up' | 'down'>>;
};

@Injectable()
export class AiService {
  constructor(
    private readonly geminiClient: GeminiClientService,
    private readonly chatService: ChatService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly rewardsService: RewardsService,
    @Inject(forwardRef(() => RoadmapService))
    private readonly roadmapService: RoadmapService,
    private readonly quizGenerationService: QuizGenerationService,
    private readonly flashcardService: FlashcardService,
    @Inject(forwardRef(() => QuizzesService))
    private readonly quizzesService: QuizzesService,
    @Inject(forwardRef(() => QuizScheduleService))
    private readonly quizScheduleService: QuizScheduleService,
    private readonly speechTranscriptionService: SpeechTranscriptionService,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    private readonly redisService: RedisService,
  ) {}

  async checkUserCredits(userId: string): Promise<number> {
    try {
      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new NotFoundException(`User with id ${userId} not found`);
      }

      return Number(user.credits || 0);
    } catch (error) {
      console.error('Failed to check user credits', error);
      throw error;
    }
  }

  private normalizeToolCallArgs(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* ignore */
      }
    }
    return {};
  }

  private async runScheduleQuizGenerationFromTool(
    userId: string,
    rawArgs: unknown,
  ): Promise<string> {
    const args = this.normalizeToolCallArgs(rawArgs);
    const topic = args.topic;
    const cronExpression = args.cronExpression;
    const rawDiff = args.difficulty;
    const timeZoneRaw = args.timeZone;

    let difficulty: 'easy' | 'medium' | 'hard' = 'medium';
    if (rawDiff === 'easy' || rawDiff === 'medium' || rawDiff === 'hard') {
      difficulty = rawDiff;
    }

    const cronStr =
      typeof cronExpression === 'string' ? cronExpression.trim() : '';
    const cronFields = cronStr.split(/\s+/).filter(Boolean);
    if (cronFields.length !== 5) {
      return `I need a valid schedule (day and time). Try again with when you want quizzes—for example every day at 9:00.\n\n`;
    }

    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return `I need a topic for your scheduled quizzes. What should they focus on?\n\n`;
    }

    const timeZone =
      typeof timeZoneRaw === 'string' && timeZoneRaw.trim().length > 0
        ? timeZoneRaw.trim()
        : undefined;

    try {
      await this.quizScheduleService.upsertForUser(userId, {
        topic: topic.trim(),
        difficulty,
        cronExpression: cronStr,
        ...(timeZone ? { timeZone } : {}),
      });
      return (
        `⏰ **Quiz schedule saved**\n\n` +
        `Topic: **${topic.trim()}** (${difficulty})\n` +
        `Schedule: \`${cronStr}\`${timeZone ? ` (${timeZone})` : ' (UTC)'}\n\n` +
        `You'll get a notification when each quiz is generated (0.5 credits per run).\n\n`
      );
    } catch (error) {
      console.error('scheduleQuizGeneration tool failed:', error);
      return `I couldn't save your quiz schedule. Please try again.\n\n`;
    }
  }

  private async generateFlashcardDeckContent(
    userId: string,
    topic: string,
    cardCount: number,
  ): Promise<{ title: string; cards: { front: string; back: string }[] }> {
    const topicTrimmed = topic.trim();
    const u = await this.authService.getUserById(userId);
    if (!u) {
      throw new NotFoundException('User not found');
    }

    const model = u.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const userPayload = `Topic / instructions:\n${topicTrimmed}\n\nGenerate exactly ${cardCount} flashcards. Return a deck title and ${cardCount} cards.`;

    let result: { text?: string } | undefined;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        result = await Promise.race([
          this.geminiClient.genAI.models.generateContent({
            model,
            contents: [
              { role: 'user', parts: [{ text: userPayload }] },
            ],
            config: {
              temperature: 0.2,
              maxOutputTokens: Math.min(8192, 400 + cardCount * 220),
              systemInstruction: FLASHCARD_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: {
                    type: Type.STRING,
                    description: 'Short title for this deck',
                  },
                  cards: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        front: {
                          type: Type.STRING,
                          description: 'Question or term on the front',
                        },
                        back: {
                          type: Type.STRING,
                          description: 'Answer or explanation on the back',
                        },
                      },
                      required: ['front', 'back'],
                    },
                  },
                },
                required: ['title', 'cards'],
              },
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Request timeout - AI service took too long to respond',
                  ),
                ),
              90000,
            ),
          ),
        ]);
        break;
      } catch (attemptError) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(
            `Failed to generate flashcards after ${maxAttempts} attempts. ${
              attemptError instanceof Error
                ? attemptError.message
                : 'AI service unavailable'
            }`,
          );
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const response = result?.text ?? '';
    if (!response.trim()) {
      throw new Error('AI returned empty response. Please try again.');
    }

    let parsed: { title: string; cards: { front: string; back: string }[] };
    try {
      parsed = JSON.parse(response) as {
        title: string;
        cards: { front: string; back: string }[];
      };
    } catch {
      throw new Error('Failed to parse flashcards from AI response.');
    }

    if (
      !parsed.title?.trim() ||
      !Array.isArray(parsed.cards) ||
      parsed.cards.length !== cardCount
    ) {
      throw new Error(
        `Expected exactly ${cardCount} cards and a non-empty title. Please try again.`,
      );
    }

    for (let i = 0; i < parsed.cards.length; i++) {
      const c = parsed.cards[i];
      if (
        !c.front?.trim() ||
        !c.back?.trim() ||
        typeof c.front !== 'string' ||
        typeof c.back !== 'string'
      ) {
        throw new Error(`Card ${i + 1} is invalid. Please try again.`);
      }
    }

    return parsed;
  }

  private async generatePublicQuizDeckContent(
    userId: string,
    topic: string,
    questionCount: number,
  ): Promise<{
    title: string;
    description?: string;
    questions: {
      question: string;
      options: string[];
      correctAnswer: string;
      explanation: string;
    }[];
  }> {
    const topicTrimmed = topic.trim();
    const u = await this.authService.getUserById(userId);
    if (!u) {
      throw new NotFoundException('User not found');
    }

    const model = u.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const userPayload = `Topic / instructions:\n${topicTrimmed}\n\nGenerate exactly ${questionCount} multiple-choice questions. Each question must have exactly 4 options; correctAnswer must equal one option exactly. Include a short quiz title and optional one-line description.`;

    let result: { text?: string } | undefined;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        result = await Promise.race([
          this.geminiClient.genAI.models.generateContent({
            model,
            contents: [
              { role: 'user', parts: [{ text: userPayload }] },
            ],
            config: {
              temperature: 0.2,
              maxOutputTokens: Math.min(8192, 400 + questionCount * 280),
              systemInstruction:
                'You create accurate educational multiple-choice quizzes for Web3 and technical topics. Output must follow the JSON schema exactly.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: {
                    type: Type.STRING,
                    description: 'Short title for the quiz listing',
                  },
                  description: {
                    type: Type.STRING,
                    description: 'Optional subtitle or scope (one line)',
                  },
                  questions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        question: { type: Type.STRING },
                        options: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                        correctAnswer: { type: Type.STRING },
                        explanation: { type: Type.STRING },
                      },
                      required: [
                        'question',
                        'options',
                        'correctAnswer',
                        'explanation',
                      ],
                    },
                  },
                },
                required: ['title', 'questions'],
              },
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    'Request timeout - AI service took too long to respond',
                  ),
                ),
              90000,
            ),
          ),
        ]);
        break;
      } catch (attemptError) {
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(
            `Failed to generate quiz after ${maxAttempts} attempts. ${
              attemptError instanceof Error
                ? attemptError.message
                : 'AI service unavailable'
            }`,
          );
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    const response = result?.text ?? '';
    if (!response.trim()) {
      throw new Error('AI returned empty response. Please try again.');
    }

    let parsed: {
      title: string;
      description?: string;
      questions: {
        question: string;
        options: string[];
        correctAnswer: string;
        explanation: string;
      }[];
    };
    try {
      parsed = JSON.parse(response) as typeof parsed;
    } catch {
      throw new Error('Failed to parse quiz from AI response.');
    }

    if (
      !parsed.title?.trim() ||
      !Array.isArray(parsed.questions) ||
      parsed.questions.length !== questionCount
    ) {
      throw new Error(
        `Expected exactly ${questionCount} questions and a non-empty title. Please try again.`,
      );
    }

    for (let i = 0; i < parsed.questions.length; i++) {
      const q = parsed.questions[i];
      if (
        !q.question?.trim() ||
        !Array.isArray(q.options) ||
        q.options.length !== 4 ||
        !q.correctAnswer ||
        !q.explanation?.trim() ||
        !q.options.includes(q.correctAnswer)
      ) {
        throw new Error(`Question ${i + 1} is invalid. Please try again.`);
      }
    }

    return {
      title: parsed.title.trim(),
      description: parsed.description?.trim(),
      questions: parsed.questions,
    };
  }

  async generateTitleFromMessage(message: Message): Promise<string> {
    try {
      const formattedMessage = {
        role: 'user',
        text: message.content,
      };

      const result = await Promise.race([
        this.geminiClient.genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [formattedMessage],
          config: {
            maxOutputTokens: 500,
            temperature: 0.1,
            systemInstruction: `
              Generate a short title based on the first user message.
              Ensure it is not more than 80 characters.
              The title should be a summary of the user's message.
              Do not use quotes or colons.
            `,
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), 10000),
        ),
      ]);

      const titleResponse = (result as { text?: string }).text?.trim();
      return titleResponse || 'Untitled Chat';
    } catch (error) {
      console.error('Error generating title:', error);

      try {
        const words = String(message.content).split(' ');
        const shortTitle = words.slice(0, 5).join(' ');
        return shortTitle.length > 30
          ? `${shortTitle.substring(0, 30)}...`
          : shortTitle || 'Untitled Chat';
      } catch (fallbackError) {
        console.error('Error in fallback title generation:', fallbackError);
        return 'Untitled Chat';
      }
    }
  }

  async generateResponse({
    messages,
    chatId,
    userId,
  }: {
    messages: Array<Message>;
    chatId: string;
    userId: string;
  }): Promise<Message> {
    const recentUserMessage = getMostRecentUserMessage(messages);
    if (!recentUserMessage) {
      throw new NotFoundException('No user message found');
    }

    let chat;
    if (chatId) {
      chat = await this.chatService.getChatById(chatId);
    }

    if (!chat) {
      const title = await this.generateTitleFromMessage(recentUserMessage);
      chat = await this.chatService.createChat({ title, userId, chatId });
      chatId = chat.id;
    }

    if (chat.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to access this chat',
      );
    }
    const user = await this.authService.getUserById(userId);

    const userRewards = await this.rewardsService.getUserRewards(userId);
    const userCertificateIds = new Set(userRewards.map((reward) => reward.id));

    const ownedCertificates: string[] = [];
    const availableCertificates: string[] = [];

    for (const [key, nftReward] of Object.entries(nftRewards)) {
      if (userCertificateIds.has(nftReward.id)) {
        ownedCertificates.push(`${key} (${nftReward.name})`);
      } else {
        availableCertificates.push(`${key} (${nftReward.name})`);
      }
    }

    if (!user?.isPremium) {
      const existingMessages = await this.chatService.getMessagesInChat(chatId);
      const messageCount = existingMessages.length;

      if (messageCount >= 30) {
        const messageLimitMessage = {
          id: generateUUID(),
          role: 'assistant' as const,
          content: {
            text: "🚀 You've reached the 30 message limit for this chat! To continue learning:\n\n✨ **Upgrade to Premium** for unlimited messages and exclusive features\n🆕 **Start a new chat** to continue with your free plan\n\nPremium users get unlimited messages, priority support, and access to advanced AI models. Upgrade now to unlock your full learning potential! 🎓",
          },
          createdAt: new Date(),
          chatId,
        };

        await this.chatService.saveMessages({
          messages: [messageLimitMessage],
        });
        return messageLimitMessage;
      }
    }

    const systemInstruction = buildTutorSystemInstruction({
      user,
      ownedCertificates,
      availableCertificates,
    });

    await this.chatService.saveMessages({
      messages: [
        {
          ...recentUserMessage,
          createdAt: new Date(),
          chatId,
          content: recentUserMessage.content,
        },
      ],
    });

    try {
      const userCredits = await this.checkUserCredits(userId);
      if (userCredits < 0.5) {
        const outOfCreditsMessage = {
          id: generateUUID(),
          role: 'assistant' as const,
          content: {
            text: "You've run out of credits! To continue using EduLearn AI, please purchase $EDLN tokens to get more credits or upgrade your plan in the app settings. Premium users get more daily credits and additional benefits.",
          },
          createdAt: new Date(),
          chatId,
        };

        await this.chatService.saveMessages({
          messages: [outOfCreditsMessage],
        });
        return outOfCreditsMessage;
      }

      const formattedMessages = messages.map((msg: any) => {
        let textContent = '';

        if (typeof msg.content === 'string') {
          textContent = msg.content;
        } else if (msg.content && typeof msg.content.text === 'string') {
          textContent = msg.content.text;
        } else if (msg.content && typeof msg.content === 'object') {
          textContent = JSON.stringify(msg.content);
        } else {
          textContent = String(msg.content || '');
        }

        return {
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: textContent }],
        };
      });

      const result = await Promise.race([
        this.geminiClient.genAI.models.generateContent({
          model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
          contents: formattedMessages,
          config: {
            tools: [
              {
                functionDeclarations: [...GEMINI_TUTOR_FUNCTION_DECLARATIONS],
              },
            ],
            maxOutputTokens: 5000,
            temperature: 1,
            systemInstruction: systemInstruction,
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), 30000),
        ),
      ]);

      await this.authService.deductUserCredits(userId);

      const candidate = (
        result as {
          candidates?: Array<{
            content?: {
              parts: Array<{
                text?: string;
                functionCall?: { name: string; args: any };
              }>;
            };
          }>;
        }
      ).candidates?.[0];
      const parts = candidate?.content?.parts || [];

      const responseText = parts
        .filter((part: any) => typeof part.text === 'string')
        .map((part: any) => part.text)
        .join('')
        .trim();

      const functionPart = parts.find(
        (part: any) => part.functionCall?.name === 'scoreUser',
      );

      const certificatePart = parts.find(
        (part: any) => part.functionCall?.name === 'giveACertificate',
      );

      const roadmapPart = parts.find(
        (part: any) => part.functionCall?.name === 'createLearningRoadmap',
      );

      const editRoadmapPart = parts.find(
        (part: any) => part.functionCall?.name === 'editLearningRoadmap',
      );

      const flashcardPart = parts.find(
        (part: any) => part.functionCall?.name === 'createFlashcardDeck',
      );

      const publicQuizPart = parts.find(
        (part: any) => part.functionCall?.name === 'createPublicQuiz',
      );

      const scheduleQuizPart = parts.find(
        (part: any) => part.functionCall?.name === 'scheduleQuizGeneration',
      );

      let scoreAcknowledgement = '';
      let certificateAcknowledgement = '';
      let roadmapAcknowledgement = '';
      let editRoadmapAcknowledgement = '';
      let flashcardAcknowledgement = '';
      let publicQuizAcknowledgement = '';
      let scheduleQuizAcknowledgement = '';

      if (functionPart) {
        const score = Number(functionPart.functionCall?.args?.score || 0);
        if (!isNaN(score) && score > 0 && score <= 10) {
          await this.authService.updateUserXP(
            userId,
            chat.title,
            score,
            'chat',
          );
          scoreAcknowledgement = `✅ Great job! I've awarded you ${score} point${score !== 1 ? 's' : ''} for your answer 🎉\n\n`;
        }
      }

      if (certificatePart) {
        const certificateType = certificatePart.functionCall?.args?.certificate;
        const confidenceLevel = Number(
          certificatePart.functionCall?.args?.confidenceLevel || 0,
        );
        const reasoning =
          certificatePart.functionCall?.args?.reasoning ||
          'No reasoning provided';

        console.log(`Certificate Award Request:
          - Type: ${certificateType}
          - Confidence: ${confidenceLevel}/10
          - Reasoning: ${reasoning}
          - User: ${userId}`);

        if (!certificateType || !nftRewards[certificateType]) {
          console.log(
            `❌ Certificate request denied - invalid certificate type: ${certificateType}`,
          );
        } else if (confidenceLevel < 8 || confidenceLevel > 10) {
          console.log(
            `❌ Certificate request denied - confidence level ${confidenceLevel} is below minimum threshold (8) or invalid`,
          );
        } else if (!reasoning || reasoning.trim().length < 10) {
          console.log(
            `❌ Certificate request denied - insufficient reasoning provided: "${reasoning}"`,
          );
        } else if (userCertificateIds.has(nftRewards[certificateType].id)) {
          const nftReward = nftRewards[certificateType];
          console.log(`⚠️ Certificate award attempted but user already has ${certificateType} (${nftReward.name})
              - This should not happen as AI was informed of owned certificates
              - AI may have hallucinated or ignored instructions`);

          certificateAcknowledgement = '';
        } else {
          try {
            const nftReward = nftRewards[certificateType];
            await this.rewardsService.awardRewardToUser(userId, nftReward.id);

            certificateAcknowledgement =
              `🏆 **Congratulations!** 🎉\n\n` +
              `You've earned the **${nftReward.name}** badge!\n\n` +
              `${nftReward.description}\n\n` +
              `💎 You can view and claim your badge in the rewards section. Keep up the amazing learning! 🎓\n\n`;

            console.log(`✅ Successfully awarded ${certificateType} (${nftReward.name}) to user ${userId}
              - Confidence: ${confidenceLevel}/10
              - Reasoning: ${reasoning}`);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message &&
              error.message.includes('already has this reward')
            ) {
              console.log(`⚠️ User ${userId} already has ${certificateType} certificate (caught at DB level)
                  - This is a backup catch; should have been prevented earlier`);

              certificateAcknowledgement = '';
            } else {
              console.error(
                `❌ Failed to award ${certificateType} certificate to user ${userId}:`,
                error,
              );
              certificateAcknowledgement = '';
            }
          }
        }
      }

      if (roadmapPart) {
        const topic = roadmapPart.functionCall?.args?.topic;
        const userIntent = roadmapPart.functionCall?.args?.userIntent;
        console.log(
          `Roadmap creation requested for topic: ${topic}, intent: ${userIntent}`,
        );

        if (topic && typeof topic === 'string' && topic.trim().length > 0) {
          try {
            const roadmapResult = await this.roadmapService.generateRoadmap(
              userId,
              topic.trim(),
              userIntent,
            );

            const stepCount = roadmapResult.steps.length;
            const totalTime = roadmapResult.steps.reduce(
              (sum, step) => sum + (step.time || 0),
              0,
            );

            let nftBonus = '';
            if (roadmapResult.roadmap.claimableNFT) {
              const nftInfo = Object.values(nftRewards).find(
                (nft) => nft.id === roadmapResult.roadmap.claimableNFT,
              );
              if (nftInfo) {
                nftBonus = `\n🎁 **Bonus**: Complete this roadmap and take at least one quiz to unlock the **${nftInfo.name}** badge! 🏆\n`;
              }
            }

            roadmapAcknowledgement =
              `🗺️ I've created a personalized learning roadmap for "${topic}"!\n\n` +
              `📚 **${roadmapResult.roadmap.title}**\n` +
              `${roadmapResult.roadmap.description}\n\n` +
              `✨ Your roadmap has ${stepCount} step${stepCount !== 1 ? 's' : ''} (${totalTime} minutes total)\n` +
              nftBonus +
              `[ROADMAP_CARD:${roadmapResult.roadmap.id}]\n\n` +
              `You can view and start your roadmap using the card above or through the roadmap feature in the app!\n\n`;

            console.log(
              `Created roadmap ${roadmapResult.roadmap.id} for user ${userId}, topic: ${topic}${roadmapResult.roadmap.claimableNFT ? ` with claimable Badge: ${roadmapResult.roadmap.claimableNFT}` : ''}`,
            );
          } catch (error) {
            console.error(
              `Failed to create roadmap for user ${userId}, topic ${topic}:`,
              error,
            );
            roadmapAcknowledgement = `I tried to create a roadmap for "${topic}", but encountered an issue. Please try again or rephrase your request. 🔄\n\n`;
          }
        } else {
          console.log(`Roadmap creation skipped - invalid topic: ${topic}`);
        }
      }

      if (editRoadmapPart) {
        const roadmapId = editRoadmapPart.functionCall?.args?.roadmapId;
        const modifications = editRoadmapPart.functionCall?.args?.modifications;
        const changeReason = editRoadmapPart.functionCall?.args?.changeReason;

        console.log(
          `Roadmap edit requested for roadmap: ${roadmapId}, modifications: ${modifications?.length || 0}`,
        );

        if (
          roadmapId &&
          Array.isArray(modifications) &&
          modifications.length > 0
        ) {
          try {
            const updatedSteps =
              await this.roadmapService.editMultipleRoadmapSteps(
                roadmapId,
                modifications,
              );

            editRoadmapAcknowledgement =
              `✏️ I've updated your roadmap!\n\n` +
              `📝 **Changes made**: ${changeReason}\n` +
              `✅ Updated ${updatedSteps.length} step${updatedSteps.length !== 1 ? 's' : ''}\n\n` +
              `[ROADMAP_CARD:${roadmapId}]\n\n`;

            console.log(
              `Updated roadmap ${roadmapId} for user ${userId}: ${updatedSteps.length} steps modified`,
            );
          } catch (error) {
            console.error(
              `Failed to edit roadmap ${roadmapId} for user ${userId}:`,
              error,
            );
            editRoadmapAcknowledgement = `I tried to update the roadmap, but encountered an issue. Please try again. 🔄\n\n`;
          }
        } else {
          console.log(`Roadmap edit skipped - invalid parameters`);
        }
      }

      if (flashcardPart) {
        const fcArgs = this.normalizeToolCallArgs(
          flashcardPart.functionCall?.args,
        );
        const topic = fcArgs.topic;
        const userIntent = fcArgs.userIntent;
        const rawCount = fcArgs.cardCount;
        console.log(
          `Flashcard deck requested for topic: ${topic}, intent: ${userIntent}`,
        );

        let cardCount = 15;
        const n =
          typeof rawCount === 'number'
            ? rawCount
            : typeof rawCount === 'string'
              ? Number(rawCount)
              : NaN;
        if (!Number.isNaN(n)) {
          cardCount = Math.min(30, Math.max(5, Math.floor(n)));
        }

        if (topic && typeof topic === 'string' && topic.trim().length > 0) {
          try {
            const parsed = await this.generateFlashcardDeckContent(
              userId,
              topic.trim(),
              cardCount,
            );
            const { deck } = await this.flashcardService.saveFlashcardDeck({
              userId,
              topic: topic.trim(),
              title: parsed.title,
              cards: parsed.cards,
            });

            const n = parsed.cards.length;
            flashcardAcknowledgement =
              `🃏 I've created a flashcard deck for "${topic}"!\n\n` +
              `📚 **${parsed.title.trim()}**\n` +
              `✨ ${n} card${n !== 1 ? 's' : ''}\n\n` +
              `[FLASHCARD_CARD:${deck.id}]\n\n` +
              `Open your deck in the flashcards section to study!\n\n`;

            console.log(
              `Created flashcard deck ${deck.id} for user ${userId}, topic: ${topic}`,
            );
          } catch (error) {
            console.error(
              `Failed to create flashcards for user ${userId}, topic ${topic}:`,
              error,
            );
            if (error instanceof ForbiddenException) {
              flashcardAcknowledgement = `${error.message}\n\n`;
            } else {
              flashcardAcknowledgement = `I tried to create flashcards for "${topic}", but encountered an issue. Please try again or rephrase your request. 🔄\n\n`;
            }
          }
        } else {
          console.log(`Flashcard creation skipped - invalid topic: ${topic}`);
        }
      }

      if (publicQuizPart) {
        const pqArgs = this.normalizeToolCallArgs(
          publicQuizPart.functionCall?.args,
        );
        const topic = pqArgs.topic;
        const userIntent = pqArgs.userIntent;
        const quizTitleArg = pqArgs.quizTitle;
        const rawQ = pqArgs.questionCount;
        console.log(
          `Public quiz requested for topic: ${topic}, intent: ${userIntent}`,
        );

        let questionCount = 10;
        const n =
          typeof rawQ === 'number'
            ? rawQ
            : typeof rawQ === 'string'
              ? Number(rawQ)
              : NaN;
        if (!Number.isNaN(n)) {
          questionCount = Math.min(20, Math.max(5, Math.floor(n)));
        }

        if (topic && typeof topic === 'string' && topic.trim().length > 0) {
          try {
            const parsed = await this.generatePublicQuizDeckContent(
              userId,
              topic.trim(),
              questionCount,
            );
            const title =
              typeof quizTitleArg === 'string' && quizTitleArg.trim().length > 0
                ? quizTitleArg.trim()
                : parsed.title;
            const saved = await this.quizzesService.publish(userId, {
              title,
              description: parsed.description,
              questions: parsed.questions,
              sourceChatId: chatId,
            });
            const nq = parsed.questions.length;
            publicQuizAcknowledgement =
              `📝 I've published a ${nq}-question quiz for "${topic}"!\n\n` +
              `**${saved.title}**\n\n` +
              `[PUBLIC_QUIZ_CARD:${saved.id}]\n\n` +
              `Others can open it from community quizzes and use Participate before submitting answers.\n\n`;
            console.log(
              `Published public quiz ${saved.id} for user ${userId}, topic: ${topic}`,
            );
          } catch (error) {
            console.error(
              `Failed to publish public quiz for user ${userId}, topic ${topic}:`,
              error,
            );
            if (
              error instanceof BadRequestException ||
              error instanceof ForbiddenException
            ) {
              publicQuizAcknowledgement = `${(error as Error).message}\n\n`;
            } else {
              publicQuizAcknowledgement = `I tried to publish a quiz for "${topic}", but encountered an issue. Please try again or rephrase your request. 🔄\n\n`;
            }
          }
        } else {
          console.log(`Public quiz creation skipped - invalid topic: ${topic}`);
        }
      }

      if (scheduleQuizPart) {
        scheduleQuizAcknowledgement =
          await this.runScheduleQuizGenerationFromTool(
            userId,
            scheduleQuizPart.functionCall?.args,
          );
      }

      const fullResponse =
        `${scoreAcknowledgement}${certificateAcknowledgement}${roadmapAcknowledgement}${editRoadmapAcknowledgement}${flashcardAcknowledgement}${publicQuizAcknowledgement}${scheduleQuizAcknowledgement}${responseText}`.trim();
      const assistantMessage = {
        id: generateUUID(),
        role: 'assistant' as const,
        content: { text: fullResponse },
        createdAt: new Date(),
        chatId,
      };

      await this.chatService.saveMessages({ messages: [assistantMessage] });

      return assistantMessage;
    } catch (error) {
      console.error('Error generating response:', error);

      const fallbackResponse = {
        id: generateUUID(),
        role: 'assistant' as const,
        content: {
          text:
            "I'm sorry, but I'm having trouble connecting to my knowledge base at the moment. " +
            'This could be due to network connectivity issues. Please check your internet connection ' +
            'and try again in a few moments.',
        },
        createdAt: new Date(),
        chatId,
      };

      await this.chatService.saveMessages({ messages: [fallbackResponse] });

      return fallbackResponse;
    }
  }

  generateResponseStream({
    messages,
    chatId,
    userId,
  }: {
    messages: Array<Message>;
    chatId: string;
    userId: string;
  }): any {
    const { Observable } = require('rxjs');

    return new Observable((subscriber) => {
      (async () => {
        if(messages.length >= 10) {
          const { success, memory } = await this.extractMemoryAndSaveToDb(userId, messages);
          if(!success) {
            throw new Error('Failed to extract memory');
          }
        }
      })();
      (async () => {
        try {
          const recentUserMessage = getMostRecentUserMessage(messages);
          if (!recentUserMessage) {
            subscriber.error(new NotFoundException('No user message found'));
            return;
          }

          let chat;
          if (chatId) {
            chat = await this.chatService.getChatById(chatId);
          }

          if (!chat) {
            const title =
              await this.generateTitleFromMessage(recentUserMessage);
            chat = await this.chatService.createChat({ title, userId, chatId });
            chatId = chat.id;
          }

          if (chat.userId !== userId) {
            subscriber.error(
              new ForbiddenException(
                'You do not have permission to access this chat',
              ),
            );
            return;
          }

          const user = await this.authService.getUserById(userId);

          const userRewards = await this.rewardsService.getUserRewards(userId);
          const userCertificateIds = new Set(
            userRewards.map((reward) => reward.id),
          );

          const ownedCertificates: string[] = [];
          const availableCertificates: string[] = [];

          for (const [key, nftReward] of Object.entries(nftRewards)) {
            if (userCertificateIds.has(nftReward.id)) {
              ownedCertificates.push(`${key} (${nftReward.name})`);
            } else {
              availableCertificates.push(`${key} (${nftReward.name})`);
            }
          }

          if (!user?.isPremium) {
            const existingMessages =
              await this.chatService.getMessagesInChat(chatId);
            const messageCount = existingMessages.length;

            if (messageCount >= 30) {
              const messageLimitText =
                "🚀 You've reached the 30 message limit for this chat! To continue learning:\n\n✨ **Upgrade to Premium** for unlimited messages and exclusive features\n🆕 **Start a new chat** to continue with your free plan\n\nPremium users get unlimited messages, priority support, and access to advanced AI models. Upgrade now to unlock your full learning potential! 🎓";

              subscriber.next({
                data: { token: messageLimitText, type: 'limit' },
              });

              const messageLimitMessage = {
                id: generateUUID(),
                role: 'assistant',
                content: { text: messageLimitText },
                createdAt: new Date(),
                chatId,
              };

              await this.chatService.saveMessages({
                messages: [messageLimitMessage],
              });

              subscriber.next({
                event: 'done',
                data: {
                  id: messageLimitMessage.id,
                  chatId,
                  complete: true,
                },
              });

              subscriber.complete();
              return;
            }
          }

          const systemInstruction = buildTutorSystemInstruction({
            user,
            ownedCertificates,
            availableCertificates,
          });

          await this.chatService.saveMessages({
            messages: [
              {
                ...recentUserMessage,
                createdAt: new Date(),
                chatId,
                content: recentUserMessage.content,
              },
            ],
          });

          const userCredits = await this.checkUserCredits(userId);
          if (userCredits < 0.5) {
            const outOfCreditsText =
              "You've run out of credits! To continue using EduLearn AI, please purchase $EDLN tokens to get more credits or upgrade your plan in the app settings. Premium users get more daily credits and additional benefits.";

            subscriber.next({
              data: { token: outOfCreditsText, type: 'limit' },
            });

            const outOfCreditsMessage = {
              id: generateUUID(),
              role: 'assistant',
              content: { text: outOfCreditsText },
              createdAt: new Date(),
              chatId,
            };

            await this.chatService.saveMessages({
              messages: [outOfCreditsMessage],
            });

            subscriber.next({
              event: 'done',
              data: {
                id: outOfCreditsMessage.id,
                chatId,
                complete: true,
              },
            });

            subscriber.complete();
            return;
          }

          const formattedMessages = messages.map((msg: any) => {
            let textContent = '';

            if (typeof msg.content === 'string') {
              textContent = msg.content;
            } else if (msg.content && typeof msg.content.text === 'string') {
              textContent = msg.content.text;
            } else if (msg.content && typeof msg.content === 'object') {
              textContent = JSON.stringify(msg.content);
            } else {
              textContent = String(msg.content || '');
            }

            return {
              role: msg.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: textContent }],
            };

          });

          const hasUrl = formattedMessages.some((m: any) =>
            JSON.stringify(m).match(/https?:\/\//)
          );
          
          const tools = [
            ...(hasUrl ? [{ urlContext: {} }] : []),
            { functionDeclarations: [...GEMINI_TUTOR_FUNCTION_DECLARATIONS] },
          ];

          const stream = await this.geminiClient.genAI.models.generateContentStream({
            model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
            contents: formattedMessages,
            config: {
              tools,
              maxOutputTokens: 5000,
              temperature: 1,
              systemInstruction: systemInstruction,
            },
          });

          await this.authService.deductUserCredits(userId);

          let fullResponse = '';
          const functionCallsByName = new Map<string, any>();

          for await (const chunk of stream) {
            const candidate = chunk.candidates?.[0];
            const parts = candidate?.content?.parts || [];

            const text = parts
              .filter((part: any) => typeof part.text === 'string')
              .map((part: any) => part.text)
              .join('');

            if (text) {
              fullResponse += text;

              const words = text.split(/(\s+)/);
              for (const word of words) {
                if (word) {
                  subscriber.next({
                    data: { token: word, type: 'content' },
                  });

                  await new Promise((resolve) => setTimeout(resolve, 15));
                }
              }
            }

            const functionCall = parts.find((part: any) => part.functionCall);
            const name = functionCall?.functionCall?.name;
            if (name) {
              functionCallsByName.set(name, functionCall);
            }
          }

          const functionCalls = Array.from(functionCallsByName.values());

          const pendingFlashcards = functionCalls.some(
            (fc) => fc.functionCall?.name === 'createFlashcardDeck',
          );
          const pendingRoadmap = functionCalls.some(
            (fc) => fc.functionCall?.name === 'createLearningRoadmap',
          );
          const pendingPublicQuiz = functionCalls.some(
            (fc) => fc.functionCall?.name === 'createPublicQuiz',
          );
          const pendingScheduleQuiz = functionCalls.some(
            (fc) => fc.functionCall?.name === 'scheduleQuizGeneration',
          );
          if (
            pendingFlashcards ||
            pendingRoadmap ||
            pendingPublicQuiz ||
            pendingScheduleQuiz
          ) {
            const statusParts: string[] = [];
            if (pendingRoadmap) statusParts.push('roadmap');
            if (pendingFlashcards) statusParts.push('flashcard deck');
            if (pendingPublicQuiz) statusParts.push('quiz');
            if (pendingScheduleQuiz) statusParts.push('quiz schedule');
            const status =
              statusParts.length > 1
                ? `Creating your ${statusParts.join(' and ')}…\n\n`
                : pendingRoadmap
                  ? 'Creating your learning roadmap…\n\n'
                  : pendingFlashcards
                    ? 'Creating your flashcard deck…\n\n'
                    : pendingPublicQuiz
                      ? 'Publishing your quiz…\n\n'
                      : 'Saving your quiz schedule…\n\n';
            subscriber.next({
              data: { token: status, type: 'content' },
            });
            fullResponse = status + fullResponse;
          }

          let scoreAcknowledgement = '';
          let certificateAcknowledgement = '';
          let roadmapAcknowledgement = '';
          let editRoadmapAcknowledgement = '';
          let flashcardAcknowledgement = '';
          let publicQuizAcknowledgement = '';
          let scheduleQuizAcknowledgement = '';

          for (const funcCall of functionCalls) {
            if (funcCall.functionCall?.name === 'scoreUser') {
              const score = Number(funcCall.functionCall?.args?.score || 0);
              if (!isNaN(score) && score > 0 && score <= 10) {
                await this.authService.updateUserXP(
                  userId,
                  chat.title,
                  score,
                  'chat',
                );
                scoreAcknowledgement = `✅ Great job! I've awarded you ${score} point${score !== 1 ? 's' : ''} for your answer 🎉\n\n`;
              }
            }

            if (funcCall.functionCall?.name === 'giveACertificate') {
              const certificateType = funcCall.functionCall?.args?.certificate;
              const confidenceLevel = Number(
                funcCall.functionCall?.args?.confidenceLevel || 0,
              );
              const reasoning =
                funcCall.functionCall?.args?.reasoning ||
                'No reasoning provided';

              console.log(`Certificate Award Request:
          - Type: ${certificateType}
          - Confidence: ${confidenceLevel}/10
          - Reasoning: ${reasoning}
          - User: ${userId}`);

              if (!certificateType || !nftRewards[certificateType]) {
                console.log(
                  `❌ Certificate request denied - invalid certificate type: ${certificateType}`,
                );
              } else if (confidenceLevel < 8 || confidenceLevel > 10) {
                console.log(
                  `❌ Certificate request denied - confidence level ${confidenceLevel} is below minimum threshold (8) or invalid`,
                );
              } else if (!reasoning || reasoning.trim().length < 10) {
                console.log(
                  `❌ Certificate request denied - insufficient reasoning provided: "${reasoning}"`,
                );
              } else if (
                userCertificateIds.has(nftRewards[certificateType].id)
              ) {
                const nftReward = nftRewards[certificateType];
                console.log(
                  `⚠️ Certificate award attempted but user already has ${certificateType} (${nftReward.name})`,
                );
                certificateAcknowledgement = '';
              } else {
                try {
                  const nftReward = nftRewards[certificateType];
                  await this.rewardsService.awardRewardToUser(
                    userId,
                    nftReward.id,
                  );

                  certificateAcknowledgement =
                    `🏆 **Congratulations!** 🎉\n\n` +
                    `You've earned the **${nftReward.name}** badge!\n\n` +
                    `${nftReward.description}\n\n` +
                    `💎 You can view and claim your badge in the rewards section. Keep up the amazing learning! 🎓\n\n`;

                  console.log(
                    `✅ Successfully awarded ${certificateType} (${nftReward.name}) to user ${userId}`,
                  );
                } catch (error) {
                  if (
                    error.message &&
                    error.message.includes('already has this reward')
                  ) {
                    console.log(
                      `⚠️ User ${userId} already has ${certificateType} certificate (caught at DB level)`,
                    );
                    certificateAcknowledgement = '';
                  } else {
                    console.error(
                      `❌ Failed to award ${certificateType} certificate to user ${userId}:`,
                      error,
                    );
                    certificateAcknowledgement = '';
                  }
                }
              }
            }

            if (funcCall.functionCall?.name === 'createLearningRoadmap') {
              const topic = funcCall.functionCall?.args?.topic;
              const userIntent = funcCall.functionCall?.args?.userIntent;
              console.log(
                `Roadmap creation requested for topic: ${topic}, intent: ${userIntent}`,
              );

              if (
                topic &&
                typeof topic === 'string' &&
                topic.trim().length > 0
              ) {
                try {
                  const roadmapResult =
                    await this.roadmapService.generateRoadmap(
                      userId,
                      topic.trim(),
                      userIntent,
                    );

                  const stepCount = roadmapResult.steps.length;
                  const totalTime = roadmapResult.steps.reduce(
                    (sum, step) => sum + (step.time || 0),
                    0,
                  );

                  let nftBonus = '';
                  if (roadmapResult.roadmap.claimableNFT) {
                    const nftInfo = Object.values(nftRewards).find(
                      (nft) => nft.id === roadmapResult.roadmap.claimableNFT,
                    );
                    if (nftInfo) {
                      nftBonus = `\n🎁 **Bonus**: Complete this roadmap and take at least one quiz to unlock the **${nftInfo.name}** badge! 🏆\n`;
                    }
                  }

                  roadmapAcknowledgement =
                    `🗺️ I've created a personalized learning roadmap for "${topic}"!\n\n` +
                    `📚 **${roadmapResult.roadmap.title}**\n` +
                    `${roadmapResult.roadmap.description}\n\n` +
                    `✨ Your roadmap has ${stepCount} step${stepCount !== 1 ? 's' : ''} (${totalTime} minutes total)\n` +
                    nftBonus +
                    `[ROADMAP_CARD:${roadmapResult.roadmap.id}]\n\n` +
                    `You can view and start your roadmap using the card above or through the roadmap feature in the app!\n\n`;

                  console.log(
                    `Created roadmap ${roadmapResult.roadmap.id} for user ${userId}, topic: ${topic}`,
                  );
                } catch (error) {
                  console.error(
                    `Failed to create roadmap for user ${userId}, topic ${topic}:`,
                    error,
                  );
                  roadmapAcknowledgement = `I tried to create a roadmap for "${topic}", but encountered an issue. Please try again or rephrase your request. 🔄\n\n`;
                }
              } else {
                console.log(
                  `Roadmap creation skipped - invalid topic: ${topic}`,
                );
              }
            }

            if (funcCall.functionCall?.name === 'editLearningRoadmap') {
              const roadmapId = funcCall.functionCall?.args?.roadmapId;
              const modifications = funcCall.functionCall?.args?.modifications;
              const changeReason = funcCall.functionCall?.args?.changeReason;

              console.log(
                `Roadmap edit requested for roadmap: ${roadmapId}, modifications: ${modifications?.length || 0}`,
              );

              if (
                roadmapId &&
                Array.isArray(modifications) &&
                modifications.length > 0
              ) {
                try {
                  const updatedSteps =
                    await this.roadmapService.editMultipleRoadmapSteps(
                      roadmapId,
                      modifications,
                    );

                  editRoadmapAcknowledgement =
                    `✏️ I've updated your roadmap!\n\n` +
                    `📝 **Changes made**: ${changeReason}\n` +
                    `✅ Updated ${updatedSteps.length} step${updatedSteps.length !== 1 ? 's' : ''}\n\n` +
                    `[ROADMAP_CARD:${roadmapId}]\n\n`;

                  console.log(
                    `Updated roadmap ${roadmapId} for user ${userId}: ${updatedSteps.length} steps modified`,
                  );
                } catch (error) {
                  console.error(
                    `Failed to edit roadmap ${roadmapId} for user ${userId}:`,
                    error,
                  );
                  editRoadmapAcknowledgement = `I tried to update the roadmap, but encountered an issue. Please try again. 🔄\n\n`;
                }
              } else {
                console.log(`Roadmap edit skipped - invalid parameters`);
              }
            }

            if (funcCall.functionCall?.name === 'createFlashcardDeck') {
              const fcArgs = this.normalizeToolCallArgs(
                funcCall.functionCall?.args,
              );
              const topic = fcArgs.topic;
              const userIntent = fcArgs.userIntent;
              const rawCount = fcArgs.cardCount;
              console.log(
                `Flashcard deck requested for topic: ${topic}, intent: ${userIntent}`,
              );

              let cardCount = 15;
              const n =
                typeof rawCount === 'number'
                  ? rawCount
                  : typeof rawCount === 'string'
                    ? Number(rawCount)
                    : NaN;
              if (!Number.isNaN(n)) {
                cardCount = Math.min(30, Math.max(5, Math.floor(n)));
              }

              if (
                topic &&
                typeof topic === 'string' &&
                topic.trim().length > 0
              ) {
                try {
                  const parsed = await this.generateFlashcardDeckContent(
                    userId,
                    topic.trim(),
                    cardCount,
                  );
                  const { deck } = await this.flashcardService.saveFlashcardDeck(
                    {
                      userId,
                      topic: topic.trim(),
                      title: parsed.title,
                      cards: parsed.cards,
                    },
                  );

                  const n = parsed.cards.length;
                  flashcardAcknowledgement =
                    `🃏 I've created a flashcard deck for "${topic}"!\n\n` +
                    `📚 **${parsed.title.trim()}**\n` +
                    `✨ ${n} card${n !== 1 ? 's' : ''}\n\n` +
                    `[FLASHCARD_CARD:${deck.id}]\n\n` +
                    `Open your deck in the flashcards section to study!\n\n`;

                  console.log(
                    `Created flashcard deck ${deck.id} for user ${userId}, topic: ${topic}`,
                  );
                } catch (error) {
                  console.error(
                    `Failed to create flashcards for user ${userId}, topic ${topic}:`,
                    error,
                  );
                  if (error instanceof ForbiddenException) {
                    flashcardAcknowledgement = `${error.message}\n\n`;
                  } else {
                    flashcardAcknowledgement = `I tried to create flashcards for "${topic}", but encountered an issue. Please try again or rephrase your request. 🔄\n\n`;
                  }
                }
              } else {
                console.log(
                  `Flashcard creation skipped - invalid topic: ${topic}`,
                );
              }
            }

            if (funcCall.functionCall?.name === 'createPublicQuiz') {
              const pqArgs = this.normalizeToolCallArgs(
                funcCall.functionCall?.args,
              );
              const topic = pqArgs.topic;
              const userIntent = pqArgs.userIntent;
              const quizTitleArg = pqArgs.quizTitle;
              const rawQ = pqArgs.questionCount;
              console.log(
                `Public quiz requested for topic: ${topic}, intent: ${userIntent}`,
              );

              let questionCount = 10;
              const n =
                typeof rawQ === 'number'
                  ? rawQ
                  : typeof rawQ === 'string'
                    ? Number(rawQ)
                    : NaN;
              if (!Number.isNaN(n)) {
                questionCount = Math.min(20, Math.max(5, Math.floor(n)));
              }

              if (
                topic &&
                typeof topic === 'string' &&
                topic.trim().length > 0
              ) {
                try {
                  const parsed = await this.generatePublicQuizDeckContent(
                    userId,
                    topic.trim(),
                    questionCount,
                  );
                  const title =
                    typeof quizTitleArg === 'string' &&
                    quizTitleArg.trim().length > 0
                      ? quizTitleArg.trim()
                      : parsed.title;
                  const saved = await this.quizzesService.publish(userId, {
                    title,
                    description: parsed.description,
                    questions: parsed.questions,
                    sourceChatId: chatId,
                  });
                  const nq = parsed.questions.length;
                  publicQuizAcknowledgement =
                    `📝 I've published a ${nq}-question quiz for "${topic}"!\n\n` +
                    `**${saved.title}**\n\n` +
                    `[PUBLIC_QUIZ_CARD:${saved.id}]\n\n` +
                    `Others can open it from community quizzes and use Participate before submitting answers.\n\n`;
                  console.log(
                    `Published public quiz ${saved.id} for user ${userId}, topic: ${topic}`,
                  );
                } catch (error) {
                  console.error(
                    `Failed to publish public quiz for user ${userId}, topic ${topic}:`,
                    error,
                  );
                  if (
                    error instanceof BadRequestException ||
                    error instanceof ForbiddenException
                  ) {
                    publicQuizAcknowledgement = `${(error as Error).message}\n\n`;
                  } else {
                    publicQuizAcknowledgement = `I tried to publish a quiz for "${topic}", but encountered an issue. Please try again or rephrase your request. 🔄\n\n`;
                  }
                }
              } else {
                console.log(
                  `Public quiz creation skipped - invalid topic: ${topic}`,
                );
              }
            }

            if (funcCall.functionCall?.name === 'scheduleQuizGeneration') {
              scheduleQuizAcknowledgement =
                await this.runScheduleQuizGenerationFromTool(
                  userId,
                  funcCall.functionCall?.args,
                );
            }
          }

          const acknowledgements =
            `${scoreAcknowledgement}${certificateAcknowledgement}${roadmapAcknowledgement}${editRoadmapAcknowledgement}${flashcardAcknowledgement}${publicQuizAcknowledgement}${scheduleQuizAcknowledgement}`.trim();
          if (acknowledgements) {
            subscriber.next({
              data: {
                token: '\n\n' + acknowledgements,
                type: 'acknowledgement',
              },
            });
            fullResponse = acknowledgements + '\n\n' + fullResponse;
          }

          const assistantMessage = {
            id: generateUUID(),
            role: 'assistant',
            content: { text: fullResponse },
            createdAt: new Date(),
            chatId,
          };

          await this.chatService.saveMessages({ messages: [assistantMessage] });

          subscriber.next({
            event: 'done',
            data: {
              id: assistantMessage.id,
              chatId,
              complete: true,
            },
          });

          subscriber.complete();
        } catch (error) {
          console.error('Error in stream:', error);
          subscriber.error(error);
        }
      })();
    });
  }

  private getXpTierFromXp(xp: number): string {
    if (xp < 100) return 'novice';
    if (xp < 500) return 'beginner';
    if (xp < 1500) return 'intermediate';
    if (xp < 3000) return 'advanced';
    return 'expert';
  }

  private studySuggestionsFingerprint(
    learning: string,
    userLevel: string,
    xpTier: string,
  ): string {
    return createHash('sha256')
      .update(`${learning}|${userLevel}|${xpTier}`)
      .digest('hex')
      .slice(0, 16);
  }

  private studySuggestionsRedisKey(userId: string, fp: string): string {
    return `study_suggestions:${userId}:${fp}`;
  }

  private parseStudySuggestionsCache(
    raw: string,
  ): StudySuggestionsRedisPayload | null {
    try {
      const data = JSON.parse(raw) as unknown;
      if (!data || typeof data !== 'object') return null;
      const o = data as Record<string, unknown>;
      if (!Array.isArray(o.suggestions) || typeof o.generatedAt !== 'string') {
        return null;
      }
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
  }

  async generateSuggestions(
    dto: GenerateSuggestionsDto,
  ): Promise<StudySuggestionsResponse> {
    const { userId, forceRefresh } = dto;
    const user = await this.authService.getUserById(userId);

    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    const xpTier = this.getXpTierFromXp(user.xp);
    const userLevel = user.level || xpTier;
    const userLearning = user.learning || 'blockchain fundamentals';
    const fp = this.studySuggestionsFingerprint(
      userLearning,
      userLevel,
      xpTier,
    );
    const key = this.studySuggestionsRedisKey(userId, fp);

    if (!forceRefresh) {
      try {
        const raw = await this.redisService.getStudySuggestionsPayload(key);
        if (raw) {
          const cached = this.parseStudySuggestionsCache(raw);
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
        throw new Error(
          'Invalid suggestions format - expected array with 3 suggestions',
        );
      }

      const three = suggestions.slice(0, 3) as string[];
      const generatedAt = new Date().toISOString();
      const payload: StudySuggestionsRedisPayload = {
        suggestions: three,
        generatedAt,
        feedback: {},
      };
      try {
        await this.redisService.setStudySuggestionsPayload(
          key,
          STUDY_SUGGESTIONS_TTL_SEC,
          JSON.stringify(payload),
        );
      } catch (e) {
        console.error('Study suggestions cache write failed:', e);
      }

      return {
        suggestions: three,
        generatedAt,
        feedback: {},
        fromCache: false,
      };
    } catch (error) {
      console.error('Error generating suggestions:', error);

      const fallbackSuggestions = {
        novice: [
          'solana consensus basics',
          'wallet security fundamentals',
          'ICM market concepts',
        ],
        beginner: [
          'anchor framework study',
          'ICM trading principles',
          'SPL token mechanics',
        ],
        intermediate: [
          'solana PDA concepts',
          'ICM protocol analysis',
          'compute units explained',
        ],
        advanced: [
          'ICM yield strategies',
          'anchor optimization patterns',
          'cross-program invocations',
        ],
        expert: [
          'ICM protocol design',
          'solana performance tuning',
          'advanced ICM applications',
        ],
      };

      const list =
        fallbackSuggestions[userLevel] || fallbackSuggestions.novice;
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
    messages: Message[]
  ): Promise<{ success: boolean; memory: string }> {
    try {
      // check existing memory first before making the API call
      const existingMemory = await this.userService.getUserMemory(userId);
  
      if (existingMemory && existingMemory.length >= MAX_MEMORY_CHARS) {
        return { success: true, memory: existingMemory }; // already at cap, skip Gemini call
      }
  
      const result = await this.geminiClient.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: extractMemoryPrompt,
        },
        contents: messages,
      });
  
      const extracted = result.text?.trim() || '';
      if (!extracted) return { success: false, memory: '' };
  
      const merged = existingMemory
        ? `${existingMemory}\n${extracted}`
        : extracted;
  
      const capped = merged.slice(0, MAX_MEMORY_CHARS);
  
      await this.userService.updateUserMemory(userId, capped);
      return { success: true, memory: capped };
    } catch (error) {
      console.error('Error extracting memory:', error);
      return { success: false, memory: '' };
    }
  }

  async updateStudySuggestionFeedback(
    dto: UpdateStudySuggestionFeedbackDto,
  ): Promise<StudySuggestionsResponse> {
    const user = await this.authService.getUserById(dto.userId);
    if (!user) {
      throw new NotFoundException(`User with id ${dto.userId} not found`);
    }

    const xpTier = this.getXpTierFromXp(user.xp);
    const userLevel = user.level || xpTier;
    const userLearning = user.learning || 'blockchain fundamentals';
    const fp = this.studySuggestionsFingerprint(
      userLearning,
      userLevel,
      xpTier,
    );
    const key = this.studySuggestionsRedisKey(dto.userId, fp);

    const raw = await this.redisService.getStudySuggestionsPayload(key);
    if (!raw) {
      throw new BadRequestException(
        'No cached study suggestions for this profile. Generate suggestions first.',
      );
    }

    const parsed = this.parseStudySuggestionsCache(raw);
    if (!parsed) {
      throw new BadRequestException('Cached study suggestions are invalid.');
    }

    const idx = String(dto.index) as '0' | '1' | '2';
    const next: StudySuggestionsRedisPayload = {
      suggestions: parsed.suggestions,
      generatedAt: parsed.generatedAt,
      feedback: { ...parsed.feedback },
    };
    if (dto.action === 'none') {
      delete next.feedback[idx];
    } else {
      next.feedback[idx] = dto.action;
    }

    const ttlRaw = await this.redisService.getStudySuggestionsTtlSeconds(key);
    const ttlSec = ttlRaw > 0 ? ttlRaw : STUDY_SUGGESTIONS_TTL_SEC;

    await this.redisService.setStudySuggestionsPayload(
      key,
      ttlSec,
      JSON.stringify(next),
    );

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

  async generateFlashcards(dto: {
    userId: string;
    topic: string;
    cardCount?: number;
  }) {
    const cardCount = dto.cardCount ?? 15;
    const parsed = await this.generateFlashcardDeckContent(
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
