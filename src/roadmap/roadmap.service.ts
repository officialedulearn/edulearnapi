import {
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from 'src/auth/auth.service';
import { roadmap, roadMapStep, chat, message } from 'lib/db/schema';
import db from '../../drizzle';
import { GoogleGenAI } from '@google/genai';
import { eq, and, desc, asc, count } from 'drizzle-orm';
import { ChatService } from 'src/chat/chat.service';
import { generateUUID } from 'lib/utils';
import { AiService } from 'src/ai/ai.service';
import { NftRewardService } from 'src/ai/nft-reward.service';
import { RewardsService } from 'src/rewards/rewards.service';
import { RemindersService } from 'src/reminders/reminders.service';
import { RedisService } from 'src/redis/redis.service';
import { NotificationsService } from 'src/common/services/notifications.service';
import { RoadmapStepStartBullmqService } from './roadmap-step-start-bullmq.service';
import type {
  RoadmapStepStartJobData,
  StartRoadmapStepBackgroundResponse,
} from './roadmap-step-start.types';

const ROADMAP_CACHE_TTL_SECONDS = 300;

@Injectable()
export class RoadmapService {
  private readonly genAI: GoogleGenAI;
  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly chatService: ChatService,
    @Inject(forwardRef(() => AiService))
    private readonly aiService: AiService,
    private readonly nftRewardService: NftRewardService,
    private readonly rewardsService: RewardsService,
    private readonly remindersService: RemindersService,
    private readonly redisService: RedisService,
    private readonly stepStartQueue: RoadmapStepStartBullmqService,
    private readonly notificationsService: NotificationsService,
  ) {
    this.genAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });
  }

  private roadmapByIdCacheKey(roadmapId: string): string {
    return `roadmap:by-id:${roadmapId}`;
  }

  private roadmapStepsCacheKey(roadmapId: string): string {
    return `roadmap:steps:${roadmapId}`;
  }

  private roadmapResponseCacheKey(roadmapId: string): string {
    return `roadmap:response:${roadmapId}`;
  }

  private roadmapsByUserCacheKey(userId: string): string {
    return `roadmap:user:${userId}`;
  }

  private async readRoadmapCache<T>(key: string): Promise<T | null> {
    try {
      const payload = await this.redisService.getRoadmapPayload(key);
      if (!payload) {
        return null;
      }
      return JSON.parse(payload) as T;
    } catch (error) {
      console.error(`Roadmap cache read failed for key ${key}:`, error);
      return null;
    }
  }

  private async setRoadmapCache(key: string, payload: unknown): Promise<void> {
    try {
      await this.redisService.setRoadmapPayload(
        key,
        ROADMAP_CACHE_TTL_SECONDS,
        JSON.stringify(payload),
      );
    } catch (error) {
      console.error(`Roadmap cache write failed for key ${key}:`, error);
    }
  }

  private async invalidateRoadmapCache(params: {
    roadmapId?: string;
    userId?: string;
  }): Promise<void> {
    const keys = new Set<string>();

    if (params.roadmapId) {
      keys.add(this.roadmapByIdCacheKey(params.roadmapId));
      keys.add(this.roadmapStepsCacheKey(params.roadmapId));
      keys.add(this.roadmapResponseCacheKey(params.roadmapId));
    }

    if (params.userId) {
      keys.add(this.roadmapsByUserCacheKey(params.userId));
    }

    if (!keys.size) {
      return;
    }

    try {
      await this.redisService.deleteRoadmapPayload([...keys]);
    } catch (error) {
      console.error('Roadmap cache invalidation failed:', error);
    }
  }

  async createRoadmap(
    userId: string,
    chatId: string,
    topic: string,
    title: string,
    description: string,
    claimableNFT?: string | null,
  ) {
    const roadmapData: any = { userId, chatId, topic, title, description };

    if (claimableNFT) {
      roadmapData.claimableNFT = claimableNFT;
    }

    const newRoadmap = await db.insert(roadmap).values(roadmapData).returning();
    await this.invalidateRoadmapCache({ userId });
    this.remindersService
      .enqueueEvaluation(userId, 'roadmap_updated')
      .catch(() => undefined);
    return newRoadmap[0];
  }

  async createRoadmapStep(
    roadmapId: string,
    prompt: string,
    title: string,
    description: string,
    time: number,
  ) {
    const newRoadmapStep = await db
      .insert(roadMapStep)
      .values({ roadmapId, prompt, title, description, time })
      .returning();
    await this.invalidateRoadmapCache({ roadmapId });
    return newRoadmapStep[0];
  }

  async generateRoadmap(
    userId: string,
    topic: string,
    userIntent?: string | null,
  ) {
    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    const totalRoadmaps = await db.select({count: count()})
    .from(roadmap)
    .where(eq(roadmap.userId, userId))
    .execute();

    if (user.isPremium = false && totalRoadmaps.length >= 3) {
      throw new BadRequestException('User has reached the maximum number of roadmaps');
    }

    const chat = await this.chatService.createChat({
      title: `Roadmap: ${topic}`,
      userId,
    });

    const roadMapSystemInstruction = `
You are EduLearn, a Web3 Study Companion that creates personalized learning roadmaps.

User Profile:
- Name: ${user.name}
- Current Level: ${user.level}
- Learning Interest: ${user.learning || 'Web3 Development'}
- Topic to Master: ${topic}

Mission:
Create a comprehensive, step-by-step learning roadmap tailored to the user's level and goals. Each step should build upon the previous one and guide the user toward mastery.

Output Format (JSON):
Return ONLY valid JSON with this exact structure:
{
  "title": "Mastering [topic]",
  "description": "A comprehensive roadmap description (2-3 sentences)",
            "steps": [
                {
      "title": "Step title (3-8 words)",
      "description": "What the user will learn in this step (1-2 sentences)",
      "time": 5(in minutes),
      "prompt": "A detailed prompt that will be sent to the AI when the user starts this step. This should guide the AI to teach the concept interactively, ask questions, and provide hands-on examples. Make it conversational and engaging."
    }
  ]
}

Requirements:
- Generate 5-8 steps based on topic complexity
- Time is in minutes (5-10 per step)
- Steps should progress from fundamentals to advanced concepts
- Each prompt is a user message that will be sent to the AI tutor on behalf of the learner
- Write prompts as if the user is asking the AI tutor for help with that specific step
- Prompts should be clear, focused questions or requests (2-4 sentences max)
- Use simple, conversational language - imagine a learner typing this message
- Tailor difficulty to user's current level (${user.level})
- Focus on Web3, blockchain, Solana, smart contracts, DeFi, or related topics
Example prompt format:
"Can you teach me the fundamentals of Solana accounts? I want to understand how they work and how they're different from other blockchains. Please explain it in a way that's easy to understand and include a practical example."

CRITICAL JSON RULES:
- Do NOT include any newlines or line breaks within JSON string values
- Do NOT use markdown formatting
- Do NOT include explanations or text outside the JSON structure
- Keep all text on single lines within strings
- Escape any quotes within strings using backslash
        `;

    try {
      const result = await this.genAI.models.generateContent({
        model: user.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: `Generate a learning roadmap for: ${topic}` }],
          },
        ],
        config: {
          maxOutputTokens: 3000,
          temperature: 0.5,
          systemInstruction: roadMapSystemInstruction,
        },
      });

      const responseText = result.text?.trim();
      if (!responseText) {
        throw new Error('Empty response from AI');
      }

      console.log('Raw AI response:', responseText.substring(0, 500));

      const jsonStr = this.extractAndCleanJSON(responseText);
      if (!jsonStr) {
        console.error('No valid JSON found in AI response:', responseText);
        throw new Error('AI service returned invalid format');
      }

      console.log(
        'Extracted JSON string (first 500 chars):',
        jsonStr.substring(0, 500),
      );

      let roadmapData;
      try {
        roadmapData = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error('JSON parsing failed:', parseError);
        console.error(
          'Failed JSON (first 1000 chars):',
          jsonStr.substring(0, 1000),
        );

        try {
          const fixedJson = this.attemptJSONFix(jsonStr);
          if (fixedJson) {
            roadmapData = JSON.parse(fixedJson);
            console.log('Successfully parsed after fixing JSON');
          } else {
            throw parseError;
          }
        } catch (secondError) {
          console.error('Second parsing attempt failed:', secondError);
          throw new Error(
            `Failed to parse roadmap JSON: ${parseError.message}`,
          );
        }
      }

      if (
        !roadmapData.title ||
        !roadmapData.description ||
        !Array.isArray(roadmapData.steps)
      ) {
        console.error('Invalid roadmap structure:', roadmapData);
        throw new Error('Invalid roadmap structure - missing required fields');
      }

      if (roadmapData.steps.length === 0) {
        throw new Error('Roadmap must have at least one step');
      }
      let claimableNFT = this.nftRewardService.analyzeTopicForNFT(topic);
      if (!claimableNFT) {
        claimableNFT =
          await this.nftRewardService.selectNftForRoadmapWithGemini(
            user.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
            {
              topic,
              roadmapTitle: roadmapData.title,
              roadmapDescription: roadmapData.description,
              userIntent: userIntent ?? undefined,
            },
          );
      }

      const newRoadmap = await this.createRoadmap(
        userId,
        chat.id,
        topic,
        roadmapData.title,
        roadmapData.description,
        claimableNFT,
      );

      const createdSteps = await Promise.all(
        roadmapData.steps.map(async (step: any) => {
          if (!step.title || !step.description || !step.prompt || !step.time) {
            console.warn('Skipping invalid step:', step);
            return null;
          }
          return await this.createRoadmapStep(
            newRoadmap.id,
            step.prompt,
            step.title,
            step.description,
            Number(step.time) || 5,
          );
        }),
      );

      const validSteps = createdSteps.filter((step) => step !== null);

      return {
        roadmap: newRoadmap,
        steps: validSteps,
      };
    } catch (error) {
      console.error('Error generating roadmap:', error);
      throw new Error(`Failed to generate roadmap: ${error.message}`);
    }
  }

  async getRoadmapById(roadmapId: string) {
    const cacheKey = this.roadmapByIdCacheKey(roadmapId);
    const cached = await this.readRoadmapCache<typeof roadmap.$inferSelect>(
      cacheKey,
    );
    if (cached) {
      return cached;
    }

    const result = await db
      .select()
      .from(roadmap)
      .where(eq(roadmap.id, roadmapId));
    const roadmapData = result.length ? result[0] : null;

    if (roadmapData) {
      await this.setRoadmapCache(cacheKey, roadmapData);
    }

    return roadmapData;
  }

  async getRoadmapsByUserId(userId: string) {
    const cacheKey = this.roadmapsByUserCacheKey(userId);
    const cached = await this.readRoadmapCache<
      Array<typeof roadmap.$inferSelect>
    >(cacheKey);
    if (cached) {
      return cached;
    }

    const roadmaps = await db
      .select()
      .from(roadmap)
      .where(eq(roadmap.userId, userId))
      .orderBy(desc(roadmap.createdAt));

    await this.setRoadmapCache(cacheKey, roadmaps);
    return roadmaps;
  }

  async getRoadmapSteps(roadmapId: string) {
    const cacheKey = this.roadmapStepsCacheKey(roadmapId);
    const cached = await this.readRoadmapCache<
      Array<(typeof roadMapStep.$inferSelect) & { done: boolean }>
    >(cacheKey);
    if (cached) {
      return cached;
    }

    const steps = await db
      .select()
      .from(roadMapStep)
      .where(eq(roadMapStep.roadmapId, roadmapId))
      .orderBy(asc(roadMapStep.createdAt));
    const normalizedSteps = steps.map((step) => ({
      ...step,
      done: Boolean(step.done),
    }));

    await this.setRoadmapCache(cacheKey, normalizedSteps);
    return normalizedSteps;
  }

  async getRoadmapWithSteps(roadmapId: string) {
    const cacheKey = this.roadmapResponseCacheKey(roadmapId);
    const cached = await this.readRoadmapCache<{
      roadmap: typeof roadmap.$inferSelect;
      steps: Array<(typeof roadMapStep.$inferSelect) & { done: boolean }>;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const roadmapData = await this.getRoadmapById(roadmapId);
    if (!roadmapData) {
      return null;
    }

    const steps = await this.getRoadmapSteps(roadmapId);
    const response = { roadmap: roadmapData, steps };

    await this.setRoadmapCache(cacheKey, response);
    return response;
  }

  async checkAndAwardRoadmapNFT(
    roadmapId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      const roadmapData = await this.getRoadmapById(roadmapId);
      if (!roadmapData) {
        console.log(`Roadmap ${roadmapId} not found`);
        return false;
      }

      if (!roadmapData.claimableNFT) {
        console.log(`No claimable NFT for roadmap ${roadmapId}`);
        return false;
      }

      const steps = await this.getRoadmapSteps(roadmapId);
      if (steps.length === 0) {
        console.log(`No steps found for roadmap ${roadmapId}`);
        return false;
      }

      const allStepsDone = steps.every((step) => step.done === true);
      if (!allStepsDone) {
        const completedCount = steps.filter(
          (step) => step.done === true,
        ).length;
        console.log(
          `Roadmap ${roadmapId} steps: ${completedCount}/${steps.length} completed`,
        );
        return false;
      }

      const chatData = await this.chatService.getChatById(roadmapData.chatId);
      if (!chatData) {
        console.log(
          `Chat ${roadmapData.chatId} not found for roadmap ${roadmapId}`,
        );
        return false;
      }

      const userRewards = await this.rewardsService.getUserRewards(userId);
      const alreadyHasNFT = userRewards.some(
        (reward) => reward.id === roadmapData.claimableNFT,
      );

      if (alreadyHasNFT) {
        console.log(
          `User ${userId} already has NFT ${roadmapData.claimableNFT}`,
        );
        return false;
      }

      console.log(
        `🎉 Awarding NFT ${roadmapData.claimableNFT} to user ${userId} for completing roadmap ${roadmapId}`,
      );

      await this.rewardsService.awardRewardToUser(
        userId,
        roadmapData.claimableNFT,
      );

      console.log(
        `✅ Successfully awarded NFT ${roadmapData.claimableNFT} to user ${userId}`,
      );
      return true;
    } catch (error) {
      console.error(
        `Error checking/awarding roadmap NFT for roadmap ${roadmapId}:`,
        error,
      );
      return false;
    }
  }

  private async getAuthorizedRoadmapStep(stepId: string, userId: string) {
    const steps = await db
      .select()
      .from(roadMapStep)
      .where(eq(roadMapStep.id, stepId));
    if (!steps.length) {
      throw new NotFoundException('Roadmap step not found');
    }
    const step = steps[0];

    const roadmapData = await this.getRoadmapById(step.roadmapId);
    if (!roadmapData) {
      throw new NotFoundException('Roadmap not found');
    }

    if (roadmapData.userId !== userId) {
      throw new NotFoundException(
        'You do not have permission to access this roadmap',
      );
    }

    return { step, roadmapData };
  }

  private async generateRoadmapStepChatResponse({
    step,
    roadmapData,
    userId,
    aiService,
  }: {
    step: typeof roadMapStep.$inferSelect;
    roadmapData: typeof roadmap.$inferSelect;
    userId: string;
    aiService: Pick<AiService, 'generateResponse'>;
  }) {
    const [persistedMessageCount, recentMessages] = await Promise.all([
      this.chatService.countMessagesInChat(roadmapData.chatId),
      this.chatService.getMessagesInChat(roadmapData.chatId, {
        offset: 0,
        limit: 2,
      }),
    ]);

    const userMessage = {
      id: generateUUID(),
      role: 'user',
      content: { text: step.prompt },
      createdAt: new Date(),
      chatId: roadmapData.chatId,
    };

    const messagesWithNewPrompt = [...recentMessages, userMessage];

    const aiResponse = await aiService.generateResponse({
      messages: messagesWithNewPrompt,
      chatId: roadmapData.chatId,
      userId,
      preloadedChatState: {
        persistedMessages: recentMessages,
        persistedMessageCount,
      },
      roadmapStepStart: true,
    });

    return { userMessage, aiResponse };
  }

  async startRoadmapStep(stepId: string, userId: string, aiService: any) {
    const { step, roadmapData } = await this.getAuthorizedRoadmapStep(
      stepId,
      userId,
    );

    const { userMessage, aiResponse } =
      await this.generateRoadmapStepChatResponse({
        step,
        roadmapData,
        userId,
        aiService,
      });

    await db
      .update(roadMapStep)
      .set({ done: true })
      .where(eq(roadMapStep.id, stepId));

    console.log(
      `Marked step ${stepId} (${step.title}) as done for user ${userId}`,
    );

    await this.invalidateRoadmapCache({ roadmapId: step.roadmapId, userId });

    this.remindersService
      .enqueueEvaluation(userId, 'roadmap_updated')
      .catch(() => undefined);

    return {
      step,
      userMessage,
      aiResponse,
    };
  }

  async startRoadmapStepInBackground(
    stepId: string,
    userId: string,
  ): Promise<StartRoadmapStepBackgroundResponse> {
    const { step, roadmapData } = await this.getAuthorizedRoadmapStep(
      stepId,
      userId,
    );

    if (step.done) {
      return {
        status: 'already_started',
        chatId: roadmapData.chatId,
        roadmapId: roadmapData.id,
        step,
        message:
          'Your agent is already preparing this step. We will notify you when it is ready.',
      };
    }

    const { enqueued } = await this.stepStartQueue.enqueueStepStart({
      userId,
      stepId,
      roadmapId: roadmapData.id,
      chatId: roadmapData.chatId,
    });

    await db
      .update(roadMapStep)
      .set({ done: true })
      .where(eq(roadMapStep.id, stepId));

    console.log(
      `Marked step ${stepId} (${step.title}) as done for user ${userId}`,
    );

    await this.invalidateRoadmapCache({ roadmapId: step.roadmapId, userId });

    this.remindersService
      .enqueueEvaluation(userId, 'roadmap_updated')
      .catch(() => undefined);

    return {
      status: enqueued ? 'queued' : 'already_started',
      chatId: roadmapData.chatId,
      roadmapId: roadmapData.id,
      step,
      message:
        'Your agent is preparing this step. We will notify you when it is ready.',
    };
  }

  async processRoadmapStepStartJob(data: RoadmapStepStartJobData) {
    const { step, roadmapData } = await this.getAuthorizedRoadmapStep(
      data.stepId,
      data.userId,
    );

    await this.generateRoadmapStepChatResponse({
      step,
      roadmapData,
      userId: data.userId,
      aiService: this.aiService,
    });

    await this.notificationsService.createNotification({
      userId: data.userId,
      title: 'Your roadmap step is ready',
      content: `${step.title} is ready in your agent chat.`,
      type: 'roadmap_step_ready',
      metadata: {
        roadmapId: roadmapData.id,
        stepId: step.id,
        chatId: roadmapData.chatId,
      },
      data: {
        screen: 'chat',
        id: roadmapData.chatId,
        chatId: roadmapData.chatId,
        roadmapId: roadmapData.id,
        stepId: step.id,
        url: `edulearnv2://chat/${roadmapData.chatId}`,
      },
    });
  }

  async editRoadmapStep(
    stepId: string,
    prompt: string,
    title: string,
    description: string,
    time: number,
  ) {
    const step = await db
      .update(roadMapStep)
      .set({ prompt, title, description, time })
      .where(eq(roadMapStep.id, stepId))
      .returning();
    if (!step || step.length === 0) {
      throw new NotFoundException('Roadmap step not found');
    }
    const updatedStep = step[0];
    const roadmapData = await this.getRoadmapById(updatedStep.roadmapId);
    await this.invalidateRoadmapCache({
      roadmapId: updatedStep.roadmapId,
      userId: roadmapData?.userId,
    });
    return updatedStep;
  }

  async editMultipleRoadmapSteps(
    roadmapId: string,
    stepsToEdit: Array<{
      stepId: string;
      prompt: string;
      title: string;
      description: string;
      time: number;
    }>,
  ) {
    const updatedSteps = await Promise.all(
      stepsToEdit.map(async (stepData) => {
        const step = await db
          .update(roadMapStep)
          .set({
            prompt: stepData.prompt,
            title: stepData.title,
            description: stepData.description,
            time: stepData.time,
          })
          .where(
            and(
              eq(roadMapStep.id, stepData.stepId),
              eq(roadMapStep.roadmapId, roadmapId),
            ),
          )
          .returning();
        return step[0];
      }),
    );
    const roadmapData = await this.getRoadmapById(roadmapId);
    await this.invalidateRoadmapCache({
      roadmapId,
      userId: roadmapData?.userId,
    });
    return updatedSteps.filter((step) => step !== null && step !== undefined);
  }

  async deleteRoadmap(roadmapId: string) {
    const roadmapData = await this.getRoadmapById(roadmapId);
    if (!roadmapData) {
      throw new NotFoundException('Roadmap not found');
    }

    const steps = await db
      .select()
      .from(roadMapStep)
      .where(eq(roadMapStep.roadmapId, roadmapId));
    if (!steps || steps.length === 0) {
      throw new NotFoundException('Roadmap steps not found');
    }
    for (const step of steps) {
      await db.delete(roadMapStep).where(eq(roadMapStep.id, step.id));
    }
    await db.delete(roadmap).where(eq(roadmap.id, roadmapId));
    await this.invalidateRoadmapCache({ roadmapId, userId: roadmapData.userId });
    return { message: 'Roadmap deleted successfully' };
  }

  private extractAndCleanJSON(response: string): string | null {
    let jsonStr = response.trim();

    if (jsonStr.includes('```json')) {
      const jsonMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
    } else if (jsonStr.includes('```')) {
      const codeMatch = jsonStr.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        jsonStr = codeMatch[1].trim();
      }
    }

    const objectStart = jsonStr.indexOf('{');
    const objectEnd = jsonStr.lastIndexOf('}');

    if (objectStart !== -1 && objectEnd !== -1 && objectStart < objectEnd) {
      jsonStr = jsonStr.substring(objectStart, objectEnd + 1);
    } else {
      return null;
    }

    jsonStr = jsonStr
      .replace(/\r\n/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\n/g, ' ')
      .replace(/\t/g, ' ');

    jsonStr = jsonStr.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

    jsonStr = jsonStr.replace(/\s+/g, ' ');

    jsonStr = jsonStr.trim();

    return jsonStr;
  }

  private attemptJSONFix(jsonStr: string): string | null {
    try {
      let fixed = jsonStr;

      const lastValidEnd = fixed.lastIndexOf('}');
      if (lastValidEnd > 0) {
        const afterLastValid = fixed.substring(lastValidEnd + 1).trim();
        if (afterLastValid && !afterLastValid.match(/^[,\s]*$/)) {
          fixed = fixed.substring(0, lastValidEnd + 1);
        }
      }

      fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

      let openBraces = 0;
      let openBrackets = 0;
      let inString = false;
      let escaped = false;

      for (let i = 0; i < fixed.length; i++) {
        const char = fixed[i];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === '\\') {
          escaped = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === '{') openBraces++;
          else if (char === '}') openBraces--;
          else if (char === '[') openBrackets++;
          else if (char === ']') openBrackets--;
        }
      }

      while (openBrackets > 0) {
        fixed += ']';
        openBrackets--;
      }
      while (openBraces > 0) {
        fixed += '}';
        openBraces--;
      }

      if (!inString) {
      } else {
        const lastQuotePos = fixed.lastIndexOf('"');
        const afterQuote = fixed.substring(lastQuotePos + 1);

        const nextComma = afterQuote.indexOf(',');
        const nextBrace = afterQuote.indexOf('}');
        const nextBracket = afterQuote.indexOf(']');

        let insertPos = fixed.length;
        if (nextComma !== -1)
          insertPos = Math.min(insertPos, lastQuotePos + 1 + nextComma);
        if (nextBrace !== -1)
          insertPos = Math.min(insertPos, lastQuotePos + 1 + nextBrace);
        if (nextBracket !== -1)
          insertPos = Math.min(insertPos, lastQuotePos + 1 + nextBracket);

        fixed =
          fixed.substring(0, insertPos) + '"' + fixed.substring(insertPos);
      }

      return fixed;
    } catch (error) {
      console.error('Error attempting JSON fix:', error);
      return null;
    }
  }
}
