import { Type } from '@google/genai';
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Message } from 'lib/db/schema';
import { getMostRecentUserMessage } from 'lib/utils';
import { AuthService } from 'src/auth/auth.service';
import { ChatService } from 'src/chat/chat.service';
import { generateUUID } from 'lib/utils';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { RewardsService } from 'src/rewards/rewards.service';
import { RoadmapService } from 'src/roadmap/roadmap.service';
import type { File } from 'multer';
import { nftRewards } from './config/nft-rewards';
import { buildTutorSystemInstruction } from './prompts/tutor-system-prompt';
import { GEMINI_TUTOR_FUNCTION_DECLARATIONS } from './prompts/gemini-tools';
import { GeminiClientService } from './gemini-client.service';
import { QuizGenerationService } from './quiz-generation.service';
import { FlashcardService } from './flashcard.service';
import { SpeechTranscriptionService } from './speech-transcription.service';

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
    private readonly speechTranscriptionService: SpeechTranscriptionService,
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

      let scoreAcknowledgement = '';
      let certificateAcknowledgement = '';
      let roadmapAcknowledgement = '';
      let editRoadmapAcknowledgement = '';

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

      const fullResponse =
        `${scoreAcknowledgement}${certificateAcknowledgement}${roadmapAcknowledgement}${editRoadmapAcknowledgement}${responseText}`.trim();
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

          const stream = await this.geminiClient.genAI.models.generateContentStream({
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
          });

          await this.authService.deductUserCredits(userId);

          let fullResponse = '';
          const functionCalls: any[] = [];

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
            if (functionCall) {
              functionCalls.push(functionCall);
            }
          }

          let scoreAcknowledgement = '';
          let certificateAcknowledgement = '';
          let roadmapAcknowledgement = '';
          let editRoadmapAcknowledgement = '';

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
          }

          const acknowledgements =
            `${scoreAcknowledgement}${certificateAcknowledgement}${roadmapAcknowledgement}${editRoadmapAcknowledgement}`.trim();
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

  async generateSuggestions({ userId }: { userId: string }) {
    const user = await this.authService.getUserById(userId);

    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }

    const getXpLevel = (xp: number) => {
      if (xp < 100) return 'novice';
      if (xp < 500) return 'beginner';
      if (xp < 1500) return 'intermediate';
      if (xp < 3000) return 'advanced';
      return 'expert';
    };

    const xpLevel = getXpLevel(user.xp);
    const userLevel = user.level || xpLevel;
    const userLearning = user.learning || 'blockchain fundamentals';

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

      return suggestions.slice(0, 3);
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

      return fallbackSuggestions[userLevel] || fallbackSuggestions.novice;
    }
  }

  generateQuiz(params: { chatId: string; userId: string }) {
    return this.quizGenerationService.generateQuiz(params);
  }

  transcribeAudio(file: { path: string }) {
    return this.speechTranscriptionService.transcribeAudio(file);
  }

  transcribeAudioOnly(params: { file: File }) {
    return this.speechTranscriptionService.transcribeAudioOnly(params);
  }

  generateFlashcards(dto: {
    userId: string;
    topic: string;
    cardCount?: number;
  }) {
    return this.flashcardService.generateFlashcards(dto);
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
