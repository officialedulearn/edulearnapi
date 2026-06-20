import {
  Injectable,
  Inject,
  forwardRef,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Type } from '@google/genai';
import { Observable } from 'rxjs';
import type { Message } from 'lib/db/schema';
import { getMostRecentUserMessage, generateUUID } from 'lib/utils';
import { AuthService } from 'src/auth/auth.service';
import { ChatService } from 'src/chat/chat.service';
import { RewardsService } from 'src/rewards/rewards.service';
import { RoadmapService } from 'src/roadmap/roadmap.service';
import { QuizzesService } from 'src/quizzes/quizzes.service';
import { QuizScheduleService } from 'src/quizzes/quiz-schedule.service';
import { nftRewards } from './config/nft-rewards';
import { buildTutorSystemInstruction } from './prompts/tutor-system-prompt';
import { GEMINI_TUTOR_FUNCTION_DECLARATIONS } from './prompts/gemini-tools';
import { GeminiClientService } from './gemini-client.service';
import { FlashcardService } from './flashcard.service';
import { AiStructuredGenerationService } from './ai-structured-generation.service';
import {
  buildPrefetchedUrlContext,
  toGeminiMessageParts,
  MAX_MEMORY_CHARS,
  mergeMemoryDeduped,
  getAttachmentsFromMessageContent,
  sanitizeLeakedAssistantToolTranscript,
  formatMessageText,
} from './ai.helpers';
import {
  type ChatArtifact,
  normalizeChatArtifacts,
} from './ai-artifacts';
import { UserService } from 'src/user/user.service';
import { AgentService } from 'src/agent/agent.service';
import {
  deriveConversationContext,
  routeAiCostForUserMessage,
} from './ai-cost-router';
import { startSentrySpan } from 'src/observability/sentry';

@Injectable()
export class AiTutorChatService {
  constructor(
    private readonly geminiClient: GeminiClientService,
    private readonly chatService: ChatService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
    private readonly rewardsService: RewardsService,
    @Inject(forwardRef(() => RoadmapService))
    private readonly roadmapService: RoadmapService,
    private readonly flashcardService: FlashcardService,
    @Inject(forwardRef(() => QuizzesService))
    private readonly quizzesService: QuizzesService,
    @Inject(forwardRef(() => QuizScheduleService))
    private readonly quizScheduleService: QuizScheduleService,
    private readonly structured: AiStructuredGenerationService,
    private readonly userService: UserService,
    private readonly agentService: AgentService,
  ) {}

  private async getAgentPromptContext(userId: string): Promise<{
    name: string;
    purpose: string;
  }> {
    try {
      const agent = await this.agentService.getAgentsByUserId(userId);
      return {
        name: agent?.name?.trim() || 'EduLearn',
        purpose:
          agent?.purpose?.trim() ||
          'Help users build proof of knowledge and proof of work in Web3.',
      };
    } catch {
      return {
        name: 'EduLearn',
        purpose:
          'Help users build proof of knowledge and proof of work in Web3.',
      };
    }
  }

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

  private enforceUserAttachmentLimit(user: any, recentUserMessage: Message) {
    const limit = Number(user?.imageUploadLimit ?? 0);
    if (!Number.isFinite(limit) || limit <= 0) return;

    const attachments = getAttachmentsFromMessageContent(
      (recentUserMessage as any)?.content,
    );

    if (attachments.length > limit) {
      throw new BadRequestException(
        `Too many attachments. Your plan allows up to ${limit} attachment${limit === 1 ? '' : 's'} per message.`,
      );
    }
  }

  private isExplicitArtifactRequest(userText: string) {
    return /\b(artifact|diagram|flowchart|mind\s*map|concept\s*map|chart|graph|plot|timeline|table|visual|visualize|draw|sketch|map\s+it|show\s+(?:me\s+)?(?:this\s+)?visually|make\s+(?:me\s+)?(?:a\s+)?(?:visual|diagram|chart|artifact)|give\s+(?:me\s+)?(?:a\s+)?(?:visual|diagram|chart|artifact))\b/i.test(
      userText,
    );
  }

  private shouldConsiderArtifacts(userText: string, assistantText: string) {
    if (this.isExplicitArtifactRequest(userText)) return true;
    const combined = `${userText}\n${assistantText}`.toLowerCase();
    return /\b(diagram|artifact|chart|graph|plot|visual|visualize|draw|flowchart|flow|timeline|table|compare|comparison|concept map|mind map|process|steps|sequence|formula|explain this visually)\b/.test(
      combined,
    );
  }

  private async generateArtifactsForResponse({
    userText,
    assistantText,
    isPremium,
  }: {
    userText: string;
    assistantText: string;
    isPremium?: boolean;
  }): Promise<ChatArtifact[]> {
    if (!this.shouldConsiderArtifacts(userText, assistantText)) return [];
    const explicitRequest = this.isExplicitArtifactRequest(userText);

    try {
      const model = isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
      const result = await this.geminiClient.genAI.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Create up to 2 compact visual artifacts for this tutor response.

Artifact mode:
- If the user explicitly requested an artifact, diagram, chart, graph, table, map, or visual, you MUST return at least 1 artifact.
- If the user did not explicitly request one, return artifacts only when a visual would materially improve learning.
- Return {"artifacts": []} only when no visual is useful and explicitArtifactRequest is false.

Prefer native schemas. Use html only when the visual cannot be represented by the native schemas. Never include external network resources.

Supported native kinds and data shapes:
- flowchart, conceptMap, sequence: { "nodes": [{ "id": "a", "label": "...", "detail": "..." }], "edges": [{ "from": "a", "to": "b", "label": "..." }] }
- process, timeline, formulaSteps: { "steps": [{ "title": "...", "detail": "..." }] }
- comparison: { "items": [{ "label": "...", "value": "...", "detail": "..." }] }
- barChart, lineChart, pieChart: { "series": [{ "label": "...", "value": 12, "color": "#00C853" }] }
- metricCards: { "metrics": [{ "label": "...", "value": "...", "helper": "..." }] }
- table: { "columns": ["..."], "rows": [["..."]] }
- quizExplainer: { "question": "...", "choices": [{ "label": "...", "correct": true, "explanation": "..." }] }
- svg: { "markup": "<svg ...>...</svg>" }
- html: { "html": "<!doctype html>...", "allowScripts": false }

explicitArtifactRequest: ${explicitRequest ? 'true' : 'false'}

User request:
${userText.slice(0, 4000)}

Assistant response:
${assistantText.slice(0, 6000)}`,
              },
            ],
          },
        ],
        config: {
          temperature: 0.2,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              artifacts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    kind: { type: Type.STRING },
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    version: { type: Type.NUMBER },
                    renderer: { type: Type.STRING },
                    data: { type: Type.OBJECT },
                    fallbackText: { type: Type.STRING },
                    createdAt: { type: Type.STRING },
                  },
                  required: ['kind', 'title', 'renderer', 'data'],
                },
              },
            },
            required: ['artifacts'],
          },
        },
      });

      const parsed = JSON.parse(result?.text || '{"artifacts":[]}') as {
        artifacts?: unknown[];
      };
      const now = new Date().toISOString();
      const withIds = (parsed.artifacts || []).map((artifact) => {
        if (!artifact || typeof artifact !== 'object') return artifact;
        return {
          id: generateUUID(),
          version: 1,
          createdAt: now,
          ...(artifact as Record<string, unknown>),
        };
      });
      const artifacts = normalizeChatArtifacts(withIds).slice(0, 2);
      if (explicitRequest && artifacts.length === 0) {
        return [
          {
            id: generateUUID(),
            kind: 'process',
            title: 'Visual breakdown',
            version: 1,
            renderer: 'native',
            data: {
              steps: assistantText
                .split(/\n+/)
                .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
                .filter(Boolean)
                .slice(0, 5)
                .map((line, index) => ({
                  title: line.slice(0, 80) || `Step ${index + 1}`,
                })),
            },
            fallbackText: assistantText.slice(0, 500),
            createdAt: now,
          },
        ];
      }
      return artifacts;
    } catch (error) {
      console.warn(
        'Failed to generate chat artifacts',
        error instanceof Error ? error.message : error,
      );
      return [];
    }
  }

  private async applyUpdateUserMemoryFromTool(
    userId: string,
    rawArgs: unknown,
  ): Promise<void> {
    const args = this.normalizeToolCallArgs(rawArgs);
    const rawFacts = args.facts;
    if (!Array.isArray(rawFacts) || rawFacts.length === 0) return;
    const facts = rawFacts
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean);
    if (facts.length === 0) return;
    const existing = await this.userService.getUserMemory(userId);
    const merged = mergeMemoryDeduped(existing, facts, MAX_MEMORY_CHARS);
    if (merged !== existing) {
      await this.userService.updateUserMemory(userId, merged);
    }
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

  async generateTitleFromMessage(message: Message): Promise<string> {
    try {
      const formattedMessage = {
        role: 'user',
        text: message.content,
      };

      const result = await Promise.race([
        startSentrySpan(
          {
            name: 'Generate chat title with Gemini',
            op: 'ai.gemini.generate_title',
            attributes: {
              model: 'gemini-2.5-flash',
            },
          },
          () =>
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
        ),
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
    preloadedChatState,
    roadmapStepStart,
  }: {
    messages: Array<Message>;
    chatId: string;
    userId: string;
    preloadedChatState?: {
      persistedMessages: Array<Message>;
      persistedMessageCount: number;
    };
    roadmapStepStart?: boolean;
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
    this.enforceUserAttachmentLimit(user, recentUserMessage);

    const userMemory = await this.userService.getUserMemory(userId);

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

    const existingMessages = preloadedChatState
      ? preloadedChatState.persistedMessages
      : await this.chatService.getMessagesInChat(chatId);
    const conversationContext = deriveConversationContext(existingMessages);

    if (!user?.isPremium) {
      const messageCount = preloadedChatState
        ? preloadedChatState.persistedMessageCount
        : existingMessages.length;

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

    const agentContext = await this.getAgentPromptContext(userId);

    const systemInstruction = buildTutorSystemInstruction({
      user,
      ownedCertificates,
      availableCertificates,
      memory: userMemory,
      agentName: agentContext.name,
      agentPurpose: agentContext.purpose,
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

    const recentUserText =
      typeof recentUserMessage.content === 'string'
        ? recentUserMessage.content
        : ((recentUserMessage.content as any)?.text ?? '');
    const explicitArtifactRequest =
      this.isExplicitArtifactRequest(recentUserText);

    const routing = await routeAiCostForUserMessage({
      userText: recentUserText,
      conversationContext,
    });

    if (routing.route === 'bypass_model' && !explicitArtifactRequest) {
      console.log(
        JSON.stringify({
          aiCostRouter: true,
          route: routing.route,
          reason: routing.reason,
          userId,
          chatId,
          normalizedLen: routing.normalizedText.length,
          substantiveContext: conversationContext.hasRecentSubstantiveAssistant,
        }),
      );

      const assistantMessage = {
        id: generateUUID(),
        role: 'assistant' as const,
        content: { text: routing.replyText },
        createdAt: new Date(),
        chatId,
      };

      await this.chatService.saveMessages({ messages: [assistantMessage] });
      return assistantMessage;
    }

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

      const formattedMessages = messages.map(toGeminiMessageParts);

      const model = roadmapStepStart
        ? 'gemini-2.5-flash'
        : user?.isPremium
          ? 'gemini-2.5-pro'
          : 'gemini-2.5-flash';

      const genConfig = {
        maxOutputTokens: roadmapStepStart ? 2000 : 5000,
        temperature: 1,
        systemInstruction: systemInstruction,
        ...(roadmapStepStart
          ? {}
          : {
              tools: [
                {
                  functionDeclarations: [...GEMINI_TUTOR_FUNCTION_DECLARATIONS],
                },
              ],
            }),
      };

      const result = await Promise.race([
        startSentrySpan(
          {
            name: 'Generate tutor response with Gemini',
            op: 'ai.gemini.tutor_response',
            attributes: {
              model,
              roadmapStepStart: Boolean(roadmapStepStart),
            },
          },
          () =>
            this.geminiClient.genAI.models.generateContent({
              model,
              contents: formattedMessages,
              config: genConfig,
            }),
        ),
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
      const sanitizedResponse =
        sanitizeLeakedAssistantToolTranscript(responseText);
      if (sanitizedResponse.leakedMemoryFacts.length > 0) {
        await this.applyUpdateUserMemoryFromTool(userId, {
          facts: sanitizedResponse.leakedMemoryFacts,
        });
      }

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
            const parsed = await this.structured.generateFlashcardDeckContent(
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
            const parsed = await this.structured.generatePublicQuizDeckContent(
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
              summary: parsed.summary,
              coveredConcepts: parsed.coveredConcepts,
              challengeProfile: parsed.challengeProfile,
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

      const updateUserMemoryPart = parts.find(
        (part: any) => part.functionCall?.name === 'updateUserMemory',
      );
      if (updateUserMemoryPart) {
        await this.applyUpdateUserMemoryFromTool(
          userId,
          updateUserMemoryPart.functionCall?.args,
        );
      }

      const fullResponse =
        `${scoreAcknowledgement}${certificateAcknowledgement}${roadmapAcknowledgement}${editRoadmapAcknowledgement}${flashcardAcknowledgement}${publicQuizAcknowledgement}${scheduleQuizAcknowledgement}${sanitizedResponse.text}`.trim();
      const artifacts = await this.generateArtifactsForResponse({
        userText: recentUserText,
        assistantText: fullResponse,
        isPremium: Boolean(user?.isPremium),
      });
      const assistantMessage = {
        id: generateUUID(),
        role: 'assistant' as const,
        content:
          artifacts.length > 0
            ? { text: fullResponse, artifacts }
            : { text: fullResponse },
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
    latencyTrace,
  }: {
    messages: Array<Message>;
    chatId: string;
    userId: string;
    latencyTrace?: {
      streamId?: string;
      requestReceivedAtMs?: number;
      sseConnectedAtMs?: number;
    };
  }): any {
    return new Observable((subscriber) => {
      const abortController = new AbortController();
      let streamFinished = false;

      subscriber.add(() => {
        if (!streamFinished && !abortController.signal.aborted) {
          abortController.abort();
        }
      });

      (async () => {
        const streamStartedHr = process.hrtime.bigint();
        const requestReceivedAtMs =
          latencyTrace?.requestReceivedAtMs ?? Date.now();
        const traceStreamId =
          latencyTrace?.streamId ??
          `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const sinceStreamStartMs = () =>
          Number(process.hrtime.bigint() - streamStartedHr) / 1_000_000;
        const logStreamLatency = (
          stage: string,
          extra: Record<string, unknown> = {},
        ) => {
          console.log(
            JSON.stringify({
              aiStreamLatency: true,
              streamId: traceStreamId,
              stage,
              at: new Date().toISOString(),
              sinceRequestMs: Date.now() - requestReceivedAtMs,
              sinceStreamStartMs: Number(sinceStreamStartMs().toFixed(2)),
              ...extra,
            }),
          );
        };
        const completeStream = (
          reason: string,
          extra: Record<string, unknown> = {},
        ) => logStreamLatency('stream_completed', { reason, ...extra });
        let firstGeminiChunkSeen = false;
        let firstChunkFlushed = false;
        let emittedTokenCount = 0;
        let chunkCount = 0;

        logStreamLatency('stream_handler_started', {
          sseConnectDelayMs:
            typeof latencyTrace?.sseConnectedAtMs === 'number'
              ? latencyTrace.sseConnectedAtMs - requestReceivedAtMs
              : null,
        });

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

          const userRewardsPromise = this.rewardsService.getUserRewards(userId);
          const [user, userMemory, existingMessages, agentContext] =
            await Promise.all([
              this.authService.getUserByIdLite(userId),
              this.userService.getUserMemory(userId),
              this.chatService.getMessagesInChat(chatId),
              this.getAgentPromptContext(userId),
            ]);

          if (!user) {
            subscriber.error(
              new NotFoundException(`User with id ${userId} not found`),
            );
            return;
          }

          this.enforceUserAttachmentLimit(user, recentUserMessage);

          const userRewards = await userRewardsPromise;

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

          const conversationContext =
            deriveConversationContext(existingMessages);

          if (!user?.isPremium) {
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

              completeStream('message_limit');
              subscriber.complete();
              return;
            }
          }

          const systemInstruction = buildTutorSystemInstruction({
            user,
            ownedCertificates,
            availableCertificates,
            memory: userMemory,
            agentName: agentContext.name,
            agentPurpose: agentContext.purpose,
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

          const recentUserText =
            typeof recentUserMessage.content === 'string'
              ? recentUserMessage.content
              : ((recentUserMessage.content as any)?.text ?? '');
          const explicitArtifactRequest =
            this.isExplicitArtifactRequest(recentUserText);

          const routing = await routeAiCostForUserMessage({
            userText: recentUserText,
            conversationContext,
          });

          if (routing.route === 'bypass_model' && !explicitArtifactRequest) {
            console.log(
              JSON.stringify({
                aiCostRouter: true,
                route: routing.route,
                reason: routing.reason,
                userId,
                chatId,
                normalizedLen: routing.normalizedText.length,
                substantiveContext:
                  conversationContext.hasRecentSubstantiveAssistant,
              }),
            );

            subscriber.next({
              data: { token: routing.replyText, type: 'bypass' },
            });

            const assistantMessage = {
              id: generateUUID(),
              role: 'assistant',
              content: { text: routing.replyText },
              createdAt: new Date(),
              chatId,
            };

            await this.chatService.saveMessages({
              messages: [assistantMessage],
            });

            subscriber.next({
              event: 'done',
              data: { id: assistantMessage.id, chatId, complete: true },
            });

            completeStream('bypass_model');
            subscriber.complete();
            return;
          }

          const userCredits = Number(user?.credits ?? 0);
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

            completeStream('out_of_credits');
            subscriber.complete();
            return;
          }

          const formattedMessages = messages.map(toGeminiMessageParts);

          const lastIdx = formattedMessages.length - 1;
          if (lastIdx >= 0 && formattedMessages[lastIdx].role === 'user') {
            const firstTextPart = formattedMessages[lastIdx].parts.find(
              (p: any) => p && typeof p.text === 'string',
            );
            const originalText = String(firstTextPart?.text ?? '');
            const urlContext = await buildPrefetchedUrlContext(originalText);
            if (urlContext) {
              formattedMessages[lastIdx] = {
                role: 'user',
                parts: [{ text: `${urlContext}\n\n---\n\n${originalText}` }],
              };
            }
          }

          const estimatedPromptChars =
            systemInstruction.length +
            formattedMessages.reduce((sum, m) => {
              const partTextLen = (m.parts || []).reduce((partSum, p: any) => {
                if (typeof p?.text === 'string') return partSum + p.text.length;
                return partSum;
              }, 0);
              return sum + partTextLen;
            }, 0);

          logStreamLatency('auth_context_fetch_completed', {
            modelCandidate: user?.isPremium
              ? 'gemini-2.5-pro'
              : 'gemini-2.5-flash',
            messageCount: messages.length,
            historyCount: existingMessages.length,
            memoryChars: userMemory.length,
            systemPromptChars: systemInstruction.length,
            estimatedPromptChars,
            toolsCount: GEMINI_TUTOR_FUNCTION_DECLARATIONS.length,
          });

          const tools = [
            { functionDeclarations: [...GEMINI_TUTOR_FUNCTION_DECLARATIONS] },
          ];
          const model = user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash';

          logStreamLatency('gemini_request_started', {
            model,
            toolsEnabled: true,
            maxOutputTokens: 5000,
          });

          const stream = await startSentrySpan(
            {
              name: 'Start tutor response stream with Gemini',
              op: 'ai.gemini.tutor_stream',
              attributes: {
                model,
                toolsEnabled: true,
              },
            },
            () =>
              this.geminiClient.genAI.models.generateContentStream({
                model,
                contents: formattedMessages,
                config: {
                  tools,
                  maxOutputTokens: 5000,
                  temperature: 1,
                  systemInstruction: systemInstruction,
                  abortSignal: abortController.signal,
                },
              }),
          );

          if (abortController.signal.aborted || subscriber.closed) {
            streamFinished = true;
            completeStream('client_disconnected');
            return;
          }

          await this.authService.deductUserCredits(userId);

          let fullResponse = '';
          const functionCallsByName = new Map<string, any>();

          for await (const chunk of stream) {
            if (abortController.signal.aborted || subscriber.closed) {
              streamFinished = true;
              completeStream('client_disconnected');
              return;
            }
            chunkCount += 1;
            if (!firstGeminiChunkSeen) {
              firstGeminiChunkSeen = true;
              logStreamLatency('first_gemini_chunk_received', {
                chunkIndex: chunkCount,
              });
            }

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
                if (abortController.signal.aborted || subscriber.closed) {
                  streamFinished = true;
                  completeStream('client_disconnected');
                  return;
                }
                if (word) {
                  subscriber.next({
                    data: { token: word, type: 'content' },
                  });
                  emittedTokenCount += 1;
                  if (!firstChunkFlushed) {
                    firstChunkFlushed = true;
                    logStreamLatency('first_chunk_flushed_to_client', {
                      chunkIndex: chunkCount,
                      tokenPreview: word.slice(0, 40),
                    });
                  }

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

          if (abortController.signal.aborted || subscriber.closed) {
            streamFinished = true;
            completeStream('client_disconnected');
            return;
          }

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
            emittedTokenCount += 1;
            if (!firstChunkFlushed) {
              firstChunkFlushed = true;
              logStreamLatency('first_chunk_flushed_to_client', {
                chunkIndex: chunkCount,
                tokenPreview: status.slice(0, 40),
                source: 'post_stream_status',
              });
            }
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
            if (abortController.signal.aborted || subscriber.closed) {
              streamFinished = true;
              completeStream('client_disconnected');
              return;
            }
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
                  const parsed =
                    await this.structured.generateFlashcardDeckContent(
                      userId,
                      topic.trim(),
                      cardCount,
                    );
                  const { deck } =
                    await this.flashcardService.saveFlashcardDeck({
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
                  const parsed =
                    await this.structured.generatePublicQuizDeckContent(
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
                    summary: parsed.summary,
                    coveredConcepts: parsed.coveredConcepts,
                    challengeProfile: parsed.challengeProfile,
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

            if (funcCall.functionCall?.name === 'updateUserMemory') {
              await this.applyUpdateUserMemoryFromTool(
                userId,
                funcCall.functionCall?.args,
              );
            }
          }

          const sanitizedResponse =
            sanitizeLeakedAssistantToolTranscript(fullResponse);

          if (abortController.signal.aborted || subscriber.closed) {
            streamFinished = true;
            completeStream('client_disconnected');
            return;
          }
          if (sanitizedResponse.leakedMemoryFacts.length > 0) {
            await this.applyUpdateUserMemoryFromTool(userId, {
              facts: sanitizedResponse.leakedMemoryFacts,
            });
          }
          fullResponse = sanitizedResponse.text;

          const acknowledgements =
            `${scoreAcknowledgement}${certificateAcknowledgement}${roadmapAcknowledgement}${editRoadmapAcknowledgement}${flashcardAcknowledgement}${publicQuizAcknowledgement}${scheduleQuizAcknowledgement}`.trim();
          if (acknowledgements) {
            subscriber.next({
              data: {
                token: '\n\n' + acknowledgements,
                type: 'acknowledgement',
              },
            });
            emittedTokenCount += 1;
            if (!firstChunkFlushed) {
              firstChunkFlushed = true;
              logStreamLatency('first_chunk_flushed_to_client', {
                chunkIndex: chunkCount,
                tokenPreview: acknowledgements.slice(0, 40),
                source: 'acknowledgement',
              });
            }
            fullResponse = acknowledgements + '\n\n' + fullResponse;
          }

          const artifacts = await this.generateArtifactsForResponse({
            userText: formatMessageText(recentUserMessage),
            assistantText: fullResponse,
            isPremium: Boolean(user?.isPremium),
          });

          const assistantMessage = {
            id: generateUUID(),
            role: 'assistant',
            content:
              artifacts.length > 0
                ? { text: fullResponse, artifacts }
                : { text: fullResponse },
            createdAt: new Date(),
            chatId,
          };

          if (abortController.signal.aborted || subscriber.closed) {
            streamFinished = true;
            completeStream('client_disconnected');
            return;
          }

          await this.chatService.saveMessages({ messages: [assistantMessage] });

          subscriber.next({
            event: 'done',
            data: {
              id: assistantMessage.id,
              chatId,
              artifacts,
              complete: true,
            },
          });

          completeStream('ok', {
            chunkCount,
            emittedTokenCount,
            functionCallCount: functionCalls.length,
          });
          streamFinished = true;
          subscriber.complete();
        } catch (error) {
          if (
            abortController.signal.aborted ||
            subscriber.closed ||
            (error instanceof Error && error.name === 'AbortError')
          ) {
            streamFinished = true;
            completeStream('client_disconnected');
            return;
          }
          logStreamLatency('stream_error', {
            message: error instanceof Error ? error.message : String(error),
          });
          console.error('Error in stream:', error);
          streamFinished = true;
          subscriber.error(error);
        }
      })();
    });
  }
}
