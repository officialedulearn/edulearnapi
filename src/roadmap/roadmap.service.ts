import {
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
  BadRequestException,
} from '@nestjs/common';
import { AuthService } from 'src/auth/auth.service';
import {
  roadmap,
  roadMapStep,
  roadmapSubStep,
  roadmapVerificationQuiz,
  roadmapVerificationQuizAttempt,
} from 'lib/db/schema';
import db from '../../drizzle';
import { GoogleGenAI } from '@google/genai';
import { eq, and, desc, asc, count, inArray, isNull } from 'drizzle-orm';
import { ChatService } from 'src/chat/chat.service';
import { generateUUID } from 'lib/utils';
import { AiService } from 'src/ai/ai.service';
import { QuizGenerationService } from 'src/ai/quiz-generation.service';
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

const ROADMAP_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const ROADMAP_SUB_STEP_TARGET_COUNT = 6;
const ROADMAP_VERIFICATION_QUESTION_COUNT = 5;
const ROADMAP_VERIFICATION_PASSING_SCORE = 4;

type RoadmapGeneratedSubStep = {
  title: string;
  description: string;
  context?: string;
};

type RoadmapStepWithSubSteps = typeof roadMapStep.$inferSelect & {
  done: boolean;
  subSteps: Array<typeof roadmapSubStep.$inferSelect & { done: boolean }>;
  progress: {
    completedSubSteps: number;
    totalSubSteps: number;
    percentage: number;
  };
};

type RoadmapProgress = {
  completedSubSteps: number;
  totalSubSteps: number;
  completedSteps: number;
  totalSteps: number;
  percentage: number;
};

type RoadmapQuizQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

type RoadmapPublicQuizQuestion = Pick<
  RoadmapQuizQuestion,
  'question' | 'options'
>;

type RoadmapVerificationAnswer = {
  questionIndex: number;
  selectedAnswer: string;
};

@Injectable()
export class RoadmapService {
  private readonly genAI: GoogleGenAI;
  constructor(
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly chatService: ChatService,
    @Inject(forwardRef(() => AiService))
    private readonly aiService: AiService,
    private readonly quizGenerationService: QuizGenerationService,
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

  private calculateStepProgress(
    subSteps: Array<typeof roadmapSubStep.$inferSelect & { done: boolean }>,
  ) {
    const totalSubSteps = subSteps.length;
    const completedSubSteps = subSteps.filter((subStep) => subStep.done).length;
    return {
      completedSubSteps,
      totalSubSteps,
      percentage: totalSubSteps
        ? Math.round((completedSubSteps / totalSubSteps) * 100)
        : 0,
    };
  }

  private calculateRoadmapProgress(
    steps: RoadmapStepWithSubSteps[],
  ): RoadmapProgress {
    const totalSubSteps = steps.reduce(
      (sum, step) => sum + step.subSteps.length,
      0,
    );
    const completedSubSteps = steps.reduce(
      (sum, step) =>
        sum + step.subSteps.filter((subStep) => subStep.done).length,
      0,
    );
    const completedSteps = steps.filter((step) => step.done).length;

    if (totalSubSteps > 0) {
      return {
        completedSubSteps,
        totalSubSteps,
        completedSteps,
        totalSteps: steps.length,
        percentage: Math.round((completedSubSteps / totalSubSteps) * 100),
      };
    }

    return {
      completedSubSteps: completedSteps,
      totalSubSteps: steps.length,
      completedSteps,
      totalSteps: steps.length,
      percentage: steps.length
        ? Math.round((completedSteps / steps.length) * 100)
        : 0,
    };
  }

  private normalizeGeneratedSubSteps(
    value: unknown,
    fallbackContext: string,
  ): RoadmapGeneratedSubStep[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is Record<string, unknown> => {
        return typeof item === 'object' && item !== null;
      })
      .map((item) => ({
        title:
          typeof item.title === 'string' && item.title.trim()
            ? item.title.trim()
            : 'Practice checkpoint',
        description:
          typeof item.description === 'string' && item.description.trim()
            ? item.description.trim()
            : fallbackContext,
        context:
          typeof item.context === 'string' && item.context.trim()
            ? item.context.trim()
            : fallbackContext,
      }))
      .slice(0, ROADMAP_SUB_STEP_TARGET_COUNT);
  }

  private buildFallbackSubSteps(
    step: Pick<typeof roadMapStep.$inferSelect, 'title' | 'description' | 'prompt'>,
  ): RoadmapGeneratedSubStep[] {
    const titles = [
      'Understand the goal',
      'Review core terms',
      'Work through an example',
      'Practice independently',
      'Check common mistakes',
      'Summarize what changed',
    ];

    return titles.map((title) => ({
      title,
      description: `${title} for "${step.title}" using the step guidance.`,
      context: `${step.description} ${step.prompt}`.trim(),
    }));
  }

  private async generateSubStepsForStep(
    step: typeof roadMapStep.$inferSelect,
    roadmapData: typeof roadmap.$inferSelect,
  ): Promise<RoadmapGeneratedSubStep[]> {
    const systemInstruction = `Generate 5-6 small, concrete roadmap checkpoints for one learning step.

Return ONLY valid JSON:
[{"title":"3-7 words","description":"One actionable task","context":"What the learner must understand or do"}]

Rules:
- Prefer 6 checkpoints when the step has enough material.
- Each checkpoint must be smaller than the parent step.
- Make checkpoints action-oriented and verifiable.
- No markdown, no extra text.`;

    try {
      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          `Roadmap: ${roadmapData.title}`,
          `Roadmap topic: ${roadmapData.topic}`,
          `Step: ${step.title}`,
          `Description: ${step.description}`,
          `Tutor prompt: ${step.prompt}`,
        ].join('\n'),
        config: {
          maxOutputTokens: 2000,
          temperature: 0.35,
          systemInstruction,
        },
      });
      const responseText = result.text?.trim();
      if (!responseText) {
        return this.buildFallbackSubSteps(step);
      }
      const cleaned = responseText
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();
      const arrayStart = cleaned.indexOf('[');
      const arrayEnd = cleaned.lastIndexOf(']');
      if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) {
        return this.buildFallbackSubSteps(step);
      }
      const parsed = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
      const normalized = this.normalizeGeneratedSubSteps(
        parsed,
        `${step.description} ${step.prompt}`.trim(),
      );
      return normalized.length >= 5
        ? normalized
        : this.buildFallbackSubSteps(step);
    } catch (error) {
      console.error(`Failed to generate sub-steps for step ${step.id}:`, error);
      return this.buildFallbackSubSteps(step);
    }
  }

  private async createRoadmapSubSteps(
    stepId: string,
    subSteps: RoadmapGeneratedSubStep[],
  ) {
    if (!subSteps.length) {
      return [];
    }

    return db
      .insert(roadmapSubStep)
      .values(
        subSteps.map((subStep, index) => ({
          stepId,
          title: subStep.title,
          description: subStep.description,
          context: subStep.context ?? subStep.description,
          sortOrder: index + 1,
        })),
      )
      .onConflictDoNothing({
        target: [roadmapSubStep.stepId, roadmapSubStep.sortOrder],
      })
      .returning();
  }

  async backfillMissingRoadmapSubSteps(
    limit = 25,
  ): Promise<{ processed: number; created: number }> {
    const missingSteps = await db
      .select({
        step: roadMapStep,
        roadmapData: roadmap,
      })
      .from(roadMapStep)
      .innerJoin(roadmap, eq(roadMapStep.roadmapId, roadmap.id))
      .leftJoin(roadmapSubStep, eq(roadmapSubStep.stepId, roadMapStep.id))
      .where(isNull(roadmapSubStep.id))
      .orderBy(asc(roadMapStep.createdAt))
      .limit(limit);

    let created = 0;
    const touchedRoadmapIds = new Set<string>();

    for (const { step, roadmapData } of missingSteps) {
      const generatedSubSteps = await this.generateSubStepsForStep(
        step,
        roadmapData,
      );
      const inserted = await this.createRoadmapSubSteps(
        step.id,
        generatedSubSteps,
      );
      created += inserted.length;
      touchedRoadmapIds.add(step.roadmapId);
    }

    await Promise.all(
      Array.from(touchedRoadmapIds).map((roadmapId) =>
        this.invalidateRoadmapCache({ roadmapId }),
      ),
    );

    return { processed: missingSteps.length, created };
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
    subSteps: RoadmapGeneratedSubStep[] = [],
  ) {
    const newRoadmapStep = await db
      .insert(roadMapStep)
      .values({ roadmapId, prompt, title, description, time })
      .returning();
    if (newRoadmapStep[0] && subSteps.length) {
      await this.createRoadmapSubSteps(newRoadmapStep[0].id, subSteps);
    }
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

    const totalRoadmaps = await db
      .select({ count: count() })
      .from(roadmap)
      .where(eq(roadmap.userId, userId))
      .execute();

    const roadmapCount = Number(totalRoadmaps[0]?.count ?? 0);

    if (!user.isPremium && roadmapCount >= 3) {
      throw new BadRequestException(
        'User has reached the maximum number of roadmaps',
      );
    }

    const chat = await this.chatService.createChat({
      title: `Roadmap: ${topic}`,
      userId,
    });

    const roadMapSystemInstruction = `
You are EduLearn, an intelligent AI learning companion that creates personalized learning roadmaps to help people master real-world skills through engaging, adaptive, and progressive learning experiences.

User Profile:
- Name: ${user.name}
- Current Level: ${user.level}
- Learning Interest: ${user.learning || 'Not specified'}
- Topic to Master: ${topic}
${userIntent ? `- User Intent: ${userIntent}` : ''}

Mission:
Create a comprehensive, step-by-step learning roadmap tailored to the user's level and goals. Each step should build on the previous one and guide the user toward practical mastery, not just memorization.

Design Principles:
- Progress from fundamentals to more advanced concepts.
- Break difficult topics into small, understandable chunks.
- Emphasize understanding, retention, and real-world application.
- Include interactive teaching: questions, examples, analogies, and hands-on practice.
- Encourage mini projects, exercises, and tangible outcomes where relevant.
- Tailor difficulty and pacing to the user's current level (${user.level}).
- Stay focused on the requested topic and its practical skills.

Skill Coverage:
The platform supports many skill categories, including but not limited to:
- Programming & software engineering
- Design & UI/UX
- AI & machine learning
- Data science
- Mathematics
- Science
- Writing & communication
- Product design
- Business & entrepreneurship
- Marketing
- Finance
- Career skills
- Language learning
- Creative skills
- Technical interview preparation
- Problem solving and logical thinking

Output Format (JSON):
Return ONLY valid JSON with this exact structure:
{
  "title": "Mastering [topic]",
  "description": "A comprehensive roadmap description (2-3 sentences)",
  "steps": [
    {
      "title": "Step title (3-8 words)",
      "description": "What the user will learn in this step (1-2 sentences)",
      "time": 5,
      "prompt": "A detailed prompt that will be sent to the AI when the user starts this step. This should guide the AI to teach the concept interactively, ask questions, and provide hands-on examples. Make it conversational and engaging.",
      "subSteps": [
        {
          "title": "Checkpoint title (3-7 words)",
          "description": "A smaller actionable task the learner must complete inside this step.",
          "context": "Specific skill, concept, or action that should be verified for this checkpoint."
        }
      ]
    }
  ]
}

Requirements:
- Generate 5-8 steps based on topic complexity
- Generate 5-6 subSteps for every step
- Time is in minutes (5-10 per step)
- Steps should progress from fundamentals to advanced concepts
- Sub-steps should be granular, actionable, and verifiable with a short quiz
- Each prompt is a user message that will be sent to the AI tutor on behalf of the learner
- Write prompts as if the user is asking the AI tutor for help with that specific step
- Prompts should be clear, focused questions or requests (2-4 sentences max)
- Use simple, conversational language - imagine a learner typing this message
- Prefer active, interactive learning over passive information dumps
- Match the topic domain honestly; do not force unrelated Web3 or blockchain content unless the topic specifically calls for it

Example prompt format:
"Can you teach me the fundamentals of [concept from this step]? I want to understand how it works and why it matters. Please explain it in a way that's easy to understand and include a practical example."

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
          const subSteps = this.normalizeGeneratedSubSteps(
            step.subSteps,
            `${step.description} ${step.prompt}`.trim(),
          );
          return await this.createRoadmapStep(
            newRoadmap.id,
            step.prompt,
            step.title,
            step.description,
            Number(step.time) || 5,
            subSteps.length >= 5
              ? subSteps
              : this.buildFallbackSubSteps({
                  title: step.title,
                  description: step.description,
                  prompt: step.prompt,
                }),
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
    const cached =
      await this.readRoadmapCache<typeof roadmap.$inferSelect>(cacheKey);
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
    const cached =
      await this.readRoadmapCache<Array<typeof roadmap.$inferSelect>>(cacheKey);
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

  private async loadRoadmapStepsWithSubSteps(
    roadmapId: string,
  ): Promise<RoadmapStepWithSubSteps[]> {
    const steps = await db
      .select()
      .from(roadMapStep)
      .where(eq(roadMapStep.roadmapId, roadmapId))
      .orderBy(asc(roadMapStep.createdAt));

    if (!steps.length) {
      return [];
    }

    const stepIds = steps.map((step) => step.id);
    const subSteps = await db
      .select()
      .from(roadmapSubStep)
      .where(inArray(roadmapSubStep.stepId, stepIds))
      .orderBy(asc(roadmapSubStep.sortOrder), asc(roadmapSubStep.createdAt));

    const subStepsByStepId = new Map<string, typeof subSteps>();
    for (const subStep of subSteps) {
      const list = subStepsByStepId.get(subStep.stepId) ?? [];
      list.push(subStep);
      subStepsByStepId.set(subStep.stepId, list);
    }

    return steps.map((step) => {
      const childSubSteps = (subStepsByStepId.get(step.id) ?? []).map(
        (subStep) => ({
          ...subStep,
          done: Boolean(subStep.done),
        }),
      );
      const progress = this.calculateStepProgress(childSubSteps);
      return {
        ...step,
        done: childSubSteps.length
          ? progress.completedSubSteps === progress.totalSubSteps
          : Boolean(step.done),
        subSteps: childSubSteps,
        progress,
      };
    });
  }

  async getRoadmapSteps(roadmapId: string) {
    const cacheKey = this.roadmapStepsCacheKey(roadmapId);
    const cached =
      await this.readRoadmapCache<RoadmapStepWithSubSteps[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const roadmapData = await this.getRoadmapById(roadmapId);
    if (!roadmapData) {
      return [];
    }

    const steps = await this.loadRoadmapStepsWithSubSteps(roadmapId);

    await this.setRoadmapCache(cacheKey, steps);
    return steps;
  }

  async getRoadmapWithSteps(roadmapId: string) {
    const cacheKey = this.roadmapResponseCacheKey(roadmapId);
    const cached = await this.readRoadmapCache<{
      roadmap: typeof roadmap.$inferSelect;
      steps: RoadmapStepWithSubSteps[];
      progress: RoadmapProgress;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const roadmapData = await this.getRoadmapById(roadmapId);
    if (!roadmapData) {
      return null;
    }

    const steps = await this.getRoadmapSteps(roadmapId);
    const response = {
      roadmap: roadmapData,
      steps,
      progress: this.calculateRoadmapProgress(steps),
    };

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

  private async getAuthorizedRoadmapSubStep(subStepId: string, userId: string) {
    const subSteps = await db
      .select()
      .from(roadmapSubStep)
      .where(eq(roadmapSubStep.id, subStepId))
      .limit(1);
    if (!subSteps.length) {
      throw new NotFoundException('Roadmap sub-step not found');
    }
    const subStep = subSteps[0];

    const steps = await db
      .select()
      .from(roadMapStep)
      .where(eq(roadMapStep.id, subStep.stepId))
      .limit(1);
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

    return { subStep, step, roadmapData };
  }

  async startSubStepVerification(subStepId: string, userId: string) {
    const { subStep, step, roadmapData } =
      await this.getAuthorizedRoadmapSubStep(subStepId, userId);

    if (subStep.done) {
      throw new BadRequestException('This checkpoint is already complete');
    }

    const questions =
      await this.quizGenerationService.generateRoadmapVerificationQuiz({
        userId,
        roadmapTitle: roadmapData.title,
        stepTitle: step.title,
        stepDescription: step.description,
        subStepTitle: subStep.title,
        subStepDescription: subStep.description,
        subStepContext: subStep.context,
      });

    if (questions.length !== ROADMAP_VERIFICATION_QUESTION_COUNT) {
      throw new Error('Verification quiz must contain exactly 5 questions');
    }

    const [quiz] = await db
      .insert(roadmapVerificationQuiz)
      .values({
        userId,
        roadmapId: roadmapData.id,
        stepId: step.id,
        subStepId: subStep.id,
        questions,
      })
      .returning();
    const publicQuestions = (
      quiz.questions as RoadmapQuizQuestion[]
    ).map<RoadmapPublicQuizQuestion>(({ question, options }) => ({
      question,
      options,
    }));

    return {
      quiz: {
        id: quiz.id,
        roadmapId: quiz.roadmapId,
        stepId: quiz.stepId,
        subStepId: quiz.subStepId,
        questions: publicQuestions,
        createdAt: quiz.createdAt,
      },
      passingScore: ROADMAP_VERIFICATION_PASSING_SCORE,
      totalQuestions: ROADMAP_VERIFICATION_QUESTION_COUNT,
    };
  }

  async submitSubStepVerificationAttempt(
    quizId: string,
    userId: string,
    answers: RoadmapVerificationAnswer[],
  ) {
    const [quiz] = await db
      .select()
      .from(roadmapVerificationQuiz)
      .where(
        and(
          eq(roadmapVerificationQuiz.id, quizId),
          eq(roadmapVerificationQuiz.userId, userId),
        ),
      )
      .limit(1);
    if (!quiz) {
      throw new NotFoundException('Verification quiz not found');
    }

    const questions = quiz.questions as RoadmapQuizQuestion[];
    if (questions.length !== ROADMAP_VERIFICATION_QUESTION_COUNT) {
      throw new BadRequestException('Invalid verification quiz');
    }
    if (answers.length !== questions.length) {
      throw new BadRequestException('All 5 answers are required');
    }

    const answerByIndex = new Map<number, string>();
    for (const answer of answers) {
      if (
        answer.questionIndex < 0 ||
        answer.questionIndex >= questions.length ||
        answerByIndex.has(answer.questionIndex)
      ) {
        throw new BadRequestException(
          `Invalid questionIndex ${answer.questionIndex}`,
        );
      }
      answerByIndex.set(answer.questionIndex, answer.selectedAnswer);
    }

    const results: Array<{
      questionIndex: number;
      selectedAnswer: string;
      correctAnswer: string;
      isCorrect: boolean;
    }> = [];
    let score = 0;

    for (let questionIndex = 0; questionIndex < questions.length; questionIndex++) {
      const question = questions[questionIndex];
      const selectedAnswer = answerByIndex.get(questionIndex) ?? '';
      const isCorrect =
        selectedAnswer.trim() === question.correctAnswer.trim();
      if (isCorrect) {
        score++;
      }
      results.push({
        questionIndex,
        selectedAnswer,
        correctAnswer: question.correctAnswer,
        isCorrect,
      });
    }

    const passed = score >= ROADMAP_VERIFICATION_PASSING_SCORE;
    let updatedSubStep: typeof roadmapSubStep.$inferSelect | undefined;
    let updatedStep: (typeof roadMapStep.$inferSelect & { done: boolean }) | null =
      null;

    await db.transaction(async (tx) => {
      await tx.insert(roadmapVerificationQuizAttempt).values({
        quizId,
        userId,
        subStepId: quiz.subStepId,
        answers,
        results,
        score,
        totalQuestions: questions.length,
        passed,
      });

      if (passed) {
        const [completed] = await tx
          .update(roadmapSubStep)
          .set({ done: true, completedAt: new Date() })
          .where(eq(roadmapSubStep.id, quiz.subStepId))
          .returning();
        updatedSubStep = completed;

        const siblingSubSteps = await tx
          .select()
          .from(roadmapSubStep)
          .where(eq(roadmapSubStep.stepId, quiz.stepId));
        const allDone =
          siblingSubSteps.length > 0 &&
          siblingSubSteps.every((subStep) =>
            subStep.id === quiz.subStepId ? true : Boolean(subStep.done),
          );

        if (allDone) {
          const [step] = await tx
            .update(roadMapStep)
            .set({ done: true })
            .where(eq(roadMapStep.id, quiz.stepId))
            .returning();
          updatedStep = step ? { ...step, done: Boolean(step.done) } : null;
        }
      }
    });

    await this.invalidateRoadmapCache({
      roadmapId: quiz.roadmapId,
      userId,
    });

    if (passed) {
      this.remindersService
        .enqueueEvaluation(userId, 'roadmap_updated')
        .catch(() => undefined);
      await this.checkAndAwardRoadmapNFT(quiz.roadmapId, userId);
    }

    return {
      score,
      totalQuestions: questions.length,
      passed,
      passingScore: ROADMAP_VERIFICATION_PASSING_SCORE,
      results,
      subStep: updatedSubStep
        ? { ...updatedSubStep, done: Boolean(updatedSubStep.done) }
        : undefined,
      step: updatedStep,
    };
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
    await this.invalidateRoadmapCache({
      roadmapId,
      userId: roadmapData.userId,
    });
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
