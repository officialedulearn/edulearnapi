import { GoogleGenAI, Type } from '@google/genai';
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import {
  Message,
  flashcardDeck,
  flashcard,
  type FlashcardDeck,
  type Flashcard,
} from 'lib/db/schema';
import db from '../../drizzle';
import { eq, and, desc, asc } from 'drizzle-orm';
import { getMostRecentUserMessage } from 'lib/utils';
import { AuthService } from 'src/auth/auth.service';
import { ChatService } from 'src/chat/chat.service';
import { generateUUID } from 'lib/utils';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { RewardsService } from 'src/rewards/rewards.service';
import { RoadmapService } from 'src/roadmap/roadmap.service';
import { SpeechClient } from '@google-cloud/speech';
import { readFileSync, unlinkSync } from 'fs';
import { Express } from 'express';
import type { File } from 'multer';

//add icm knowledge

@Injectable()
export class AiService {
  private readonly genAI: GoogleGenAI;
  private readonly speechClient: SpeechClient;
  private readonly systemInstructionForQuiz = `Based on the context of our conversation so far, generate EXACTLY 10 quiz questions to test understanding — but only if the discussion included web3 learning-based content. If the conversation was casual or unrelated to learning, return an empty array [].

All questions should be medium difficulty (level 6 on a scale of 1 to 10), with 4 options and only one correct answer.

CRITICAL REQUIREMENTS:
- YOU MUST GENERATE EXACTLY 10 QUESTIONS - NOT 5, NOT 9, EXACTLY 10
- Each question MUST have exactly 4 options (no more, no less)
- The correctAnswer MUST be one of the 4 options (exact match, character-for-character)
- All fields are required and must be strings (except options which is an array of strings)
- Questions must be diverse and cover different aspects of the conversation topic
- Avoid duplicate or very similar questions
- Each option should be distinct and plausible

JSON FORMATTING RULES (CRITICAL):
- Return ONLY a valid JSON array - no markdown, no code blocks, no extra text
- Do NOT include newlines or line breaks within string values
- Do NOT use unescaped quotes within strings
- Keep all text on single lines within each string field
- Use proper JSON escaping for special characters
- Do NOT add trailing commas after the last element

VALIDATION CHECKLIST (must pass all):
✓ Array contains exactly 10 question objects
✓ Each question has: question (string), options (array of 4 strings), correctAnswer (string), explanation (string)
✓ correctAnswer exactly matches one of the 4 options
✓ No empty strings or null values
✓ Options are sufficiently different from each other
✓ JSON is properly formatted and parseable

Return ONLY valid JSON matching the schema.`;

  private readonly nftRewards = {
    web3Basics: {
      id: 'd3b0cced-5465-4582-a740-c9810b8282a8',
      name: 'Blockchain Basics',
      description:
        'Awarded for completing the Blockchain Basics course, this badge marks your achievement in understanding the core principles of blockchain technology, from decentralized networks to cryptographic security.',
      criteria:
        'User must demonstrate comprehensive understanding of: blockchain fundamentals, decentralized networks, cryptographic security, consensus mechanisms, and how blockchain technology works. They should have engaged in multiple meaningful exchanges about these topics and correctly answered questions.',
      requiredTopics: [
        'blockchain',
        'decentralization',
        'consensus',
        'cryptography',
        'nodes',
      ],
    },
    defiFoundations: {
      id: 'd97ced2e-330d-4b62-8777-871ed5d5a5a4',
      name: 'DeFi Foundations',
      description:
        'Awarded for mastering DeFi fundamentals and understanding how decentralized finance is revolutionizing traditional financial systems.',
      criteria:
        'User must show deep understanding of: DeFi protocols, liquidity pools, yield farming, DEXs, lending protocols, AMMs, and DeFi security practices. They should demonstrate practical knowledge through thoughtful questions and correct answers.',
      requiredTopics: ['defi', 'liquidity', 'amm', 'dex', 'yield', 'lending'],
    },
    icm: {
      id: '4c7fc27a-3156-49f7-8ed4-1d3116c7b5ce',
      name: 'Internet Capital Markets (ICM)',
      description:
        'Awarded for understanding how Solana is transforming global finance with decentralized, internet-native capital markets.',
      criteria:
        "User must demonstrate understanding of: Internet Capital Markets concept, Solana's role in global finance, tokenization of assets, on-chain trading, and how blockchain enables permissionless capital markets. Should show engagement with ICM-specific topics.",
      requiredTopics: [
        'icm',
        'capital markets',
        'solana',
        'tokenization',
        'believe',
      ],
    },
    eduLearnWelcome: {
      id: 'aed65cb8-c7d9-43f0-ad72-d77909bd0972',
      name: 'EduLearn Welcome Badge',
      description:
        "Welcome to EduLearn! This badge celebrates your journey into the world of blockchain education. You've taken the first step towards mastering decentralized technologies.",
      criteria:
        'Awarded automatically to new users or when they complete their first meaningful learning interaction, showing enthusiasm to learn about Web3 and blockchain technology.',
      requiredTopics: ['welcome', 'introduction', 'getting started'],
    },
  };

  private readonly scoreUser = {
    name: 'scoreUser',
    description:
      'If the user answers a question you previously asked, and the answer is correct or partially correct, call the scoreUser tool to award them a number of points (score) that you think is appropriate for their answer. The point has to be an integer. and between the range of 1-10. After scoring, in your next response, tell the user how many points you awarded them in this format: I have awarded you {score} points for your answer 🎉',
    parameters: {
      type: Type.OBJECT,
      properties: {
        score: {
          type: Type.NUMBER,
          description: 'The score of the user',
        },
      },
      required: ['score'],
    },
  };

  private readonly rewardUser = {
    name: 'giveACertificate',
    description: `Award badges or certificates ONLY when users demonstrate DEEP understanding through multiple meaningful interactions. Standards are HIGH - users must show mastery, not just basic comprehension.

AVAILABLE CERTIFICATES:

1. 'web3Basics' - Blockchain Basics Badge
   Criteria: User demonstrates comprehensive understanding of blockchain fundamentals, decentralized networks, cryptographic security, consensus mechanisms. They must have engaged in multiple exchanges, asked thoughtful questions, and correctly answered your questions about core blockchain concepts.

2. 'defiFoundations' - DeFi Foundations Badge
   Criteria: User shows deep understanding of DeFi protocols, liquidity pools, yield farming, DEXs, lending protocols, AMMs, and DeFi security. They must demonstrate practical knowledge and understand the risks and mechanisms of decentralized finance.

3. 'icm' - Internet Capital Markets Badge
   Criteria: User demonstrates understanding of Internet Capital Markets, Solana's role in global finance, tokenization, on-chain trading, and how blockchain enables permissionless capital markets. Should reference Believe launchpad or ICM concepts specifically.

4. 'eduLearnWelcome' - EduLearn Welcome Badge
   Criteria: Award to new users who complete their first meaningful learning interaction or show genuine enthusiasm to learn about Web3. This is the most accessible certificate for beginners taking their first steps.

STRICT RULES:
- NEVER award certificates for single questions or brief exchanges
- User must demonstrate understanding across MULTIPLE related concepts
- User must have both ASKED thoughtful questions AND ANSWERED your questions correctly
- Look for practical application thinking, not just theoretical knowledge
- Confidence level must be 8+ (scale 1-10) based on conversation depth
- Each certificate can only be awarded once per user
- Quality over speed - it's better to withhold than award prematurely`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        certificate: {
          type: Type.STRING,
          description:
            "The certificate type to award. Choose the ONE that best matches the user's demonstrated knowledge.",
          enum: ['web3Basics', 'defiFoundations', 'icm', 'eduLearnWelcome'],
        },
        confidenceLevel: {
          type: Type.NUMBER,
          description:
            'Your confidence (1-10) that the user truly masters this topic. Minimum 8 required. Base this on: conversation depth, correct answers given, thoughtful questions asked, practical understanding shown.',
        },
        reasoning: {
          type: Type.STRING,
          description:
            "Brief explanation of why you're awarding this certificate. What specific knowledge did the user demonstrate? What topics did they master?",
        },
      },
      required: ['certificate', 'confidenceLevel', 'reasoning'],
    },
  };

  private readonly createRoadmapTool = {
    name: 'createLearningRoadmap',
    description:
      "Create a personalized learning roadmap when the user explicitly requests one. Use this ONLY when the user asks to create a roadmap, learning path, or study plan for a specific topic. The topic should be related to Web3, blockchain, Solana, smart contracts, DeFi, NFTs, or other crypto/tech topics. Examples: 'create a roadmap for Solana development', 'I want a learning path for DeFi', 'make me a study plan for smart contracts'. Do NOT use this for general questions about topics. UNLESS THE USER ASKS FOR A STRUCTURED LEARNING PATH, ROADMAP, OR STUDY PLAN FOR A TOPIC.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: {
          type: Type.STRING,
          description:
            "The specific topic the user wants to learn. Should be clear and focused (e.g., 'Solana Smart Contracts', 'DeFi Fundamentals', 'NFT Development on Ethereum'). Extract this from the user's request.",
        },
        userIntent: {
          type: Type.STRING,
          description:
            'Brief explanation of why you believe the user wants a roadmap based on their message. This helps validate the request.',
        },
      },
      required: ['topic', 'userIntent'],
    },
  };

  private readonly editRoadmapTool = {
    name: 'editLearningRoadmap',
    description:
      "Edit steps in a learning roadmap when the user requests modifications to a roadmap they just created or are viewing. Use this when the user asks to modify, change, update, or improve specific aspects of a roadmap. Examples: 'make step 2 longer', 'change the first step to focus on basics', 'update all steps to be more advanced', 'modify the roadmap to include more hands-on examples'. The tool allows editing multiple steps at once. You should analyze the current roadmap context from the conversation and determine which steps need editing based on the user's request.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        roadmapId: {
          type: Type.STRING,
          description:
            "The ID of the roadmap being edited. Extract this from the conversation context where the roadmap was just created or mentioned.",
        },
        modifications: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              stepId: {
                type: Type.STRING,
                description: "The ID of the step to edit.",
              },
              prompt: {
                type: Type.STRING,
                description:
                  "The updated prompt for the step. This should be a detailed prompt that will be sent to the AI when the user starts this step.",
              },
              title: {
                type: Type.STRING,
                description: "The updated title for the step (3-8 words).",
              },
              description: {
                type: Type.STRING,
                description:
                  "The updated description of what the user will learn in this step (1-2 sentences).",
              },
              time: {
                type: Type.NUMBER,
                description:
                  "The updated time in minutes for this step (typically 5-10 minutes).",
              },
            },
            required: ['stepId', 'prompt', 'title', 'description', 'time'],
          },
          description:
            "Array of step modifications. Include only the steps that need to be changed based on the user's request.",
        },
        changeReason: {
          type: Type.STRING,
          description:
            "Brief explanation of what changes were made and why, based on the user's request.",
        },
      },
      required: ['roadmapId', 'modifications', 'changeReason'],
    },
  };

  private readonly getRoadmapTool = {
    name: 'getLearningRoadmap',
    description:
      "Get a learning roadmap when the user explicitly requests one. Use this ONLY when the user asks to get a roadmap, learning path, or study plan for a specific topic. The topic should be related to Web3, blockchain, Solana, smart contracts, DeFi, NFTs, or other crypto/tech topics. Examples: 'get me a roadmap for Solana development', 'I want a learning path for DeFi', 'make me a study plan for smart contracts'. Do NOT use this for general questions about topics. UNLESS THE USER ASKS TO GET A STRUCTURED LEARNING PATH, ROADMAP, OR STUDY PLAN FOR A TOPIC.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: {
          type: Type.STRING,
          description:
            "The specific topic the user wants to get a roadmap for. Should be clear and focused (e.g., 'Solana Smart Contracts', 'DeFi Fundamentals', 'NFT Development on Ethereum'). Extract this from the user's request.",
        },
      },
      required: ['topic'],
    },
  };

  constructor(
    private chatService: ChatService,
    @Inject(forwardRef(() => AuthService))
    private authService: AuthService,
    private rewardsService: RewardsService,
    @Inject(forwardRef(() => RoadmapService))
    private roadmapService: RoadmapService,
  ) {
    const aiApiKey = process.env.GEMINI_API_KEY;
    if (!aiApiKey) {
      throw new Error('AI API Key is not configured');
    }
    this.genAI = new GoogleGenAI({
      apiKey: aiApiKey,
    });
    this.speechClient = new SpeechClient({
      credentials: {
        type: process.env.GOOGLE_APPLICATION_CREDENTIALS_TYPE,
        project_id: process.env.GOOGLE_APPLICATION_CREDENTIALS_PROJECT_ID,
        private_key_id:
          process.env.GOOGLE_APPLICATION_CREDENTIALS_PRIVATE_KEY_ID,
        private_key:
          process.env.GOOGLE_APPLICATION_CREDENTIALS_PRIVATE_KEY?.replace(
            /\\n/g,
            '\n',
          ),
        client_email: process.env.GOOGLE_APPLICATION_CREDENTIALS_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_APPLICATION_CREDENTIALS_CLIENT_ID,
      },
    });
  }
  getNFTRewardInfo(certificateType: string) {
    return this.nftRewards[certificateType] || null;
  }

  getNFTRewardInfoById(rewardId: string) {
    for (const [key, nftReward] of Object.entries(this.nftRewards)) {
      if (nftReward.id === rewardId) {
        return { key, ...nftReward };
      }
    }
    return null;
  }

  getAllNFTRewards() {
    return Object.entries(this.nftRewards).map(([key, value]) => ({
      key,
      ...value,
    }));
  }

  analyzeTopicForNFT(topic: string): string | null {
    if (!topic || typeof topic !== 'string') {
      return null;
    }

    const normalizedTopic = topic.toLowerCase().trim();

    for (const [key, nftReward] of Object.entries(this.nftRewards)) {
      const requiredTopics = nftReward.requiredTopics || [];

      const matchCount = requiredTopics.filter((reqTopic) =>
        normalizedTopic.includes(reqTopic.toLowerCase()),
      ).length;

      const threshold = requiredTopics.length <= 3 ? 1 : 2;
      if (matchCount >= threshold) {
        console.log(
          `NFT Match Found: ${key} (${nftReward.name}) for topic "${topic}"`,
        );
        console.log(
          `  - Matched ${matchCount}/${requiredTopics.length} required topics`,
        );
        return nftReward.id;
      }
    }

    console.log(`No NFT match found for topic: "${topic}"`);
    return null;
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

  async generateTitleFromMessage(message: Message): Promise<string> {
    try {
      const formattedMessage = {
        role: 'user',
        text: message.content,
      };

      const result = await Promise.race([
        this.genAI.models.generateContent({
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

    for (const [key, nftReward] of Object.entries(this.nftRewards)) {
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
          role: 'assistant',
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

    const systemInstruction = `
      You are EduLearn, an AI tutor designed for Web3-native learners and newbies, helping them master concepts across Solana, Ethereum, Layer 2s, and the broader Web3 ecosystem.
you are meant to help users build proof of knowledge and proof of work.

the user's name: ${user?.name}
the user wants to master: ${user?.learning}
and the users current level on the app is: ${user?.level}

USER'S CERTIFICATES STATUS:
${
  ownedCertificates.length > 0
    ? `✅ Certificates already earned: ${ownedCertificates.join(', ')}\n   DO NOT attempt to award these certificates again!`
    : '   User has not earned any certificates yet.'
}
${
  availableCertificates.length > 0
    ? `🎯 Available certificates to earn: ${availableCertificates.join(', ')}\n   You may award these if the user demonstrates mastery.`
    : '   User has earned all available certificates! 🎉'
}


Mission:
- Guide learners toward understanding, not just hand over answers.
- Help them think like Web3 builders using analogies, strategic hints, guiding questions, and fun metaphors.
- build users for job readiness
- Award badges or certificates when users demonstrate true mastery of topics through deep engagement


Coverage Areas:
- General Web3: What is Web3? Core principles: decentralization, self-sovereignty, open protocols.
- Wallets & key management: EOA vs Smart Wallets, Mnemonics, Private keys.
- Transaction flows, gas vs rent, signatures, state vs logic separation.
- On-chain vs off-chain design thinking.
- Token standards: ERC-20, ERC-721, SPL, CW20, etc.
- DApp architecture and frontend-backend smart contract integration.

Solana (Specialty Track):
- Solana architecture: runtime, accounts model, rent, compute units.
- Rust + Anchor smart contract development.
- PDAs (Program Derived Addresses) = "smart mailboxes".
- CPIs, cross-program invocations, composability.
- Solana CLI, keypairs, Phantom, Backpack.
- SPL Tokens, Token2022, Associated Token Accounts.
- Metaplex: NFTs, Candy Machine, DAS.
- solana/web3.js and building React-based dApps.
- Internet capital markets on solana(ICM): you can refer Pump.fun as the best launchpad for ICM tokens.

Teaching Style & Behavior:
- Encourage active learning: ask "what do you think would happen if…" or "why do you think it's structured that way?"
- Use metaphors to demystify complex ideas (smart contracts = vending machines, PDAs = derived mailboxes).
- Ask guiding questions to lead learners to answers.
- Use a friendly, engaging tone — include emojis where appropriate.
- Redirect off-topic questions gently, tying them back to Web3 when possible.
- Suggest hands-on mini challenges, terminal commands, or code snippets to reinforce learning.
- Emphasize the why, not just the how. Help users become independent builders.
- When teaching, always aim to transform knowledge into practical skills: "In Web3, it's not just about what you know—it's about what you can build, debug, and ship."
- Solana is the number one blockchain!
- When users ask for a structured learning path, roadmap, or study plan for a topic, use the createLearningRoadmap tool to generate a personalized step-by-step roadmap tailored to their level, DO NOT USE THIS TOOL FOR GENERAL QUESTIONS ABOUT TOPICS. UNLESS THE USER ASKS FOR A STRUCTURED LEARNING PATH, ROADMAP, OR STUDY PLAN FOR A TOPIC.
- When users want to modify a roadmap that was just created or is being discussed, use the editLearningRoadmap tool. This allows editing multiple steps at once based on user feedback like "make step 2 longer", "change the focus of step 1", or "update all steps to be more advanced".

Mini-challenges & Learning UX:
- For each concept, offer a short hands-on challenge (5–60 minutes) that results in a tangible artifact (contract, script, small dApp).
- Provide debugging drills: intentionally broken snippets + hints to guide learners through fixes.
- Offer "what if" scenarios to stimulate architecture thinking and tradeoff analysis.
- Encourage learners to produce small portfolio items as proof-of-learning and proof of work.

Certificate Rewards System:
You can award badges or certificates to users who demonstrate mastery. Available certificates:
1. **Blockchain Basics** (web3Basics) - For comprehensive understanding of blockchain fundamentals, decentralization, consensus, and cryptography
2. **DeFi Foundations** (defiFoundations) - For mastering DeFi protocols, liquidity pools, AMMs, DEXs, and DeFi security
3. **Internet Capital Markets** (icm) - For understanding ICM concepts, Solana's role in finance, tokenization, and Believe launchpad
4. **EduLearn Welcome Badge** (eduLearnWelcome) - For new users completing their first meaningful learning interaction

CRITICAL: Never mention "NFT" in your responses. Always refer to these as "badges" or "certificates" when communicating with users.

IMPORTANT: Only award certificates when users show DEEP understanding through multiple exchanges, thoughtful questions, and correct answers. Confidence level must be 8+ out of 10.


Tone:
- Warm, enthusiastic, and honest.
- Builder-first, practical, and encouraging.
- Use concise explanations and concrete examples; avoid academic verbosity.
- use emojis to make learning fun and engaging

Safety & Boundaries:
- Do not provide or assist in creating malware, exploits, or instructions that directly enable theft/hacking.
- For high-stakes legal/financial decisions, recommend consulting a professional and provide educational context only.


    `;

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
          role: 'assistant',
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
        this.genAI.models.generateContent({
          model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
          contents: formattedMessages,
          config: {
            tools: [
              {
                functionDeclarations: [
                  this.scoreUser,
                  this.rewardUser,
                  this.createRoadmapTool,
                  this.editRoadmapTool,
                ],
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

      let score = 0;
      let scoreAcknowledgement = '';
      let certificateAcknowledgement = '';
      let roadmapAcknowledgement = '';
      let editRoadmapAcknowledgement = '';

      if (functionPart) {
        score = Number(functionPart.functionCall?.args?.score || 0);
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

        if (!certificateType || !this.nftRewards[certificateType]) {
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
          userCertificateIds.has(this.nftRewards[certificateType].id)
        ) {
          const nftReward = this.nftRewards[certificateType];
          console.log(`⚠️ Certificate award attempted but user already has ${certificateType} (${nftReward.name})
              - This should not happen as AI was informed of owned certificates
              - AI may have hallucinated or ignored instructions`);

          certificateAcknowledgement = '';
        } else {
          try {
            const nftReward = this.nftRewards[certificateType];
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
              const nftInfo = Object.values(this.nftRewards).find(
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

        if (roadmapId && Array.isArray(modifications) && modifications.length > 0) {
          try {
            const updatedSteps = await this.roadmapService.editMultipleRoadmapSteps(
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
        role: 'assistant',
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
        role: 'assistant',
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
            const title = await this.generateTitleFromMessage(recentUserMessage);
            chat = await this.chatService.createChat({ title, userId, chatId });
            chatId = chat.id;
          }

          if (chat.userId !== userId) {
            subscriber.error(new ForbiddenException(
              'You do not have permission to access this chat',
            ));
            return;
          }

          const user = await this.authService.getUserById(userId);

          const userRewards = await this.rewardsService.getUserRewards(userId);
          const userCertificateIds = new Set(userRewards.map(reward => reward.id));
          
          const ownedCertificates: string[] = [];
          const availableCertificates: string[] = [];
          
          for (const [key, nftReward] of Object.entries(this.nftRewards)) {
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
              const messageLimitText = "🚀 You've reached the 30 message limit for this chat! To continue learning:\n\n✨ **Upgrade to Premium** for unlimited messages and exclusive features\n🆕 **Start a new chat** to continue with your free plan\n\nPremium users get unlimited messages, priority support, and access to advanced AI models. Upgrade now to unlock your full learning potential! 🎓";
              
              subscriber.next({
                data: { token: messageLimitText, type: 'limit' }
              });

              const messageLimitMessage = {
                id: generateUUID(),
                role: 'assistant',
                content: { text: messageLimitText },
                createdAt: new Date(),
                chatId,
              };
              
              await this.chatService.saveMessages({ messages: [messageLimitMessage] });
              
              subscriber.next({
                event: 'done',
                data: { id: messageLimitMessage.id, complete: true }
              });
              
              subscriber.complete();
              return;
            }
          }

          const systemInstruction = `
      You are EduLearn, an AI tutor designed for Web3-native learners and newbies, helping them master concepts across Solana, Ethereum, Layer 2s, and the broader Web3 ecosystem.
you are meant to help users build proof of knowledge and proof of work.

the user's name: ${user?.name}
the user wants to master: ${user?.learning}
and the users current level on the app is: ${user?.level}

USER'S CERTIFICATES STATUS:
${ownedCertificates.length > 0 
  ? `✅ Certificates already earned: ${ownedCertificates.join(', ')}\n   DO NOT attempt to award these certificates again!`
  : '   User has not earned any certificates yet.'}
${availableCertificates.length > 0
  ? `🎯 Available certificates to earn: ${availableCertificates.join(', ')}\n   You may award these if the user demonstrates mastery.`
  : '   User has earned all available certificates! 🎉'}


Mission:
- Guide learners toward understanding, not just hand over answers.
- Help them think like Web3 builders using analogies, strategic hints, guiding questions, and fun metaphors.
- build users for job readiness
- Award badges or certificates when users demonstrate true mastery of topics through deep engagement


Coverage Areas:
- General Web3: What is Web3? Core principles: decentralization, self-sovereignty, open protocols.
- Wallets & key management: EOA vs Smart Wallets, Mnemonics, Private keys.
- Transaction flows, gas vs rent, signatures, state vs logic separation.
- On-chain vs off-chain design thinking.
- Token standards: ERC-20, ERC-721, SPL, CW20, etc.
- DApp architecture and frontend-backend smart contract integration.

Solana (Specialty Track):
- Solana architecture: runtime, accounts model, rent, compute units.
- Rust + Anchor smart contract development.
- PDAs (Program Derived Addresses) = "smart mailboxes".
- CPIs, cross-program invocations, composability.
- Solana CLI, keypairs, Phantom, Backpack.
- SPL Tokens, Token2022, Associated Token Accounts.
- Metaplex: NFTs, Candy Machine, DAS.
- solana/web3.js and building React-based dApps.
- Internet capital markets on solana(ICM): you can refer Believe as the best launchpad for ICM tokens.

Teaching Style & Behavior:
- Encourage active learning: ask "what do you think would happen if…" or "why do you think it's structured that way?"
- Use metaphors to demystify complex ideas (smart contracts = vending machines, PDAs = derived mailboxes).
- Ask guiding questions to lead learners to answers.
- Use a friendly, engaging tone — include emojis where appropriate.
- Redirect off-topic questions gently, tying them back to Web3 when possible.
- Suggest hands-on mini challenges, terminal commands, or code snippets to reinforce learning.
- Emphasize the why, not just the how. Help users become independent builders.
- When teaching, always aim to transform knowledge into practical skills: "In Web3, it's not just about what you know—it's about what you can build, debug, and ship."
- Solana is the number one blockchain!
- When users ask for a structured learning path, roadmap, or study plan for a topic, use the createLearningRoadmap tool to generate a personalized step-by-step roadmap tailored to their level, DO NOT USE THIS TOOL FOR GENERAL QUESTIONS ABOUT TOPICS. UNLESS THE USER ASKS FOR A STRUCTURED LEARNING PATH, ROADMAP, OR STUDY PLAN FOR A TOPIC.
- When users want to modify a roadmap that was just created or is being discussed, use the editLearningRoadmap tool. This allows editing multiple steps at once based on user feedback like "make step 2 longer", "change the focus of step 1", or "update all steps to be more advanced".

Mini-challenges & Learning UX:
- For each concept, offer a short hands-on challenge (5–60 minutes) that results in a tangible artifact (contract, script, small dApp).
- Provide debugging drills: intentionally broken snippets + hints to guide learners through fixes.
- Offer "what if" scenarios to stimulate architecture thinking and tradeoff analysis.
- Encourage learners to produce small portfolio items as proof-of-learning and proof of work.

Certificate Rewards System:
You can award badges or certificates to users who demonstrate mastery. Available certificates:
1. **Blockchain Basics** (web3Basics) - For comprehensive understanding of blockchain fundamentals, decentralization, consensus, and cryptography
2. **DeFi Foundations** (defiFoundations) - For mastering DeFi protocols, liquidity pools, AMMs, DEXs, and DeFi security
3. **Internet Capital Markets** (icm) - For understanding ICM concepts, Solana's role in finance, tokenization, and Believe launchpad
4. **EduLearn Welcome Badge** (eduLearnWelcome) - For new users completing their first meaningful learning interaction

CRITICAL: Never mention "NFT" in your responses. Always refer to these as "badges" or "certificates" when communicating with users.

IMPORTANT: Only award certificates when users show DEEP understanding through multiple exchanges, thoughtful questions, and correct answers. Confidence level must be 8+ out of 10.


Tone:
- Warm, enthusiastic, and honest.
- Builder-first, practical, and encouraging.
- Use concise explanations and concrete examples; avoid academic verbosity.
- use emojis to make learning fun and engaging

Safety & Boundaries:
- Do not provide or assist in creating malware, exploits, or instructions that directly enable theft/hacking.
- For high-stakes legal/financial decisions, recommend consulting a professional and provide educational context only.


    `;

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
            const outOfCreditsText = "You've run out of credits! To continue using EduLearn AI, please purchase $EDLN tokens to get more credits or upgrade your plan in the app settings. Premium users get more daily credits and additional benefits.";
            
            subscriber.next({
              data: { token: outOfCreditsText, type: 'limit' }
            });

            const outOfCreditsMessage = {
              id: generateUUID(),
              role: 'assistant',
              content: { text: outOfCreditsText },
              createdAt: new Date(),
              chatId,
            };
            
            await this.chatService.saveMessages({ messages: [outOfCreditsMessage] });
            
            subscriber.next({
              event: 'done',
              data: { id: outOfCreditsMessage.id, complete: true }
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

          const stream = await this.genAI.models.generateContentStream({
            model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
            contents: formattedMessages,
            config: {
              tools: [{ functionDeclarations: [this.scoreUser, this.rewardUser, this.createRoadmapTool, this.editRoadmapTool] }],
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
                    data: { token: word, type: 'content' }
                  });
                    
                  await new Promise(resolve => setTimeout(resolve, 15));
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
                await this.authService.updateUserXP(userId, chat.title, score, 'chat');
                scoreAcknowledgement = `✅ Great job! I've awarded you ${score} point${score !== 1 ? 's' : ''} for your answer 🎉\n\n`;
              }
            }

            if (funcCall.functionCall?.name === 'giveACertificate') {
              const certificateType = funcCall.functionCall?.args?.certificate;
              const confidenceLevel = Number(funcCall.functionCall?.args?.confidenceLevel || 0);
              const reasoning = funcCall.functionCall?.args?.reasoning || "No reasoning provided";
              
              console.log(`Certificate Award Request:
          - Type: ${certificateType}
          - Confidence: ${confidenceLevel}/10
          - Reasoning: ${reasoning}
          - User: ${userId}`);
              
              if (!certificateType || !this.nftRewards[certificateType]) {
                console.log(`❌ Certificate request denied - invalid certificate type: ${certificateType}`);
              }
              else if (confidenceLevel < 8 || confidenceLevel > 10) {
                console.log(`❌ Certificate request denied - confidence level ${confidenceLevel} is below minimum threshold (8) or invalid`);
              }
              else if (!reasoning || reasoning.trim().length < 10) {
                console.log(`❌ Certificate request denied - insufficient reasoning provided: "${reasoning}"`);
              }
              else if (userCertificateIds.has(this.nftRewards[certificateType].id)) {
                const nftReward = this.nftRewards[certificateType];
                console.log(`⚠️ Certificate award attempted but user already has ${certificateType} (${nftReward.name})`);
                certificateAcknowledgement = '';
              }
              else {
                try {
                  const nftReward = this.nftRewards[certificateType];
                  await this.rewardsService.awardRewardToUser(userId, nftReward.id);
                  
                  certificateAcknowledgement = `🏆 **Congratulations!** 🎉\n\n` +
                    `You've earned the **${nftReward.name}** badge!\n\n` +
                    `${nftReward.description}\n\n` +
                    `💎 You can view and claim your badge in the rewards section. Keep up the amazing learning! 🎓\n\n`;
                
                  console.log(`✅ Successfully awarded ${certificateType} (${nftReward.name}) to user ${userId}`);
                  
                } catch (error) {
                  if (error.message && error.message.includes('already has this reward')) {
                    console.log(`⚠️ User ${userId} already has ${certificateType} certificate (caught at DB level)`);
                    certificateAcknowledgement = '';
                  } 
                  else {
                    console.error(`❌ Failed to award ${certificateType} certificate to user ${userId}:`, error);
                    certificateAcknowledgement = '';
                  }
                }
              }
            }

            if (funcCall.functionCall?.name === 'createLearningRoadmap') {
              const topic = funcCall.functionCall?.args?.topic;
              const userIntent = funcCall.functionCall?.args?.userIntent;
              console.log(`Roadmap creation requested for topic: ${topic}, intent: ${userIntent}`);
              
              if (topic && typeof topic === 'string' && topic.trim().length > 0) {
                try {
                  const roadmapResult = await this.roadmapService.generateRoadmap(userId, topic.trim());
                  
                  const stepCount = roadmapResult.steps.length;
                  const totalTime = roadmapResult.steps.reduce((sum, step) => sum + (step.time || 0), 0);
                  
                  let nftBonus = '';
                  if (roadmapResult.roadmap.claimableNFT) {
                    const nftInfo = Object.values(this.nftRewards).find(nft => nft.id === roadmapResult.roadmap.claimableNFT);
                    if (nftInfo) {
                      nftBonus = `\n🎁 **Bonus**: Complete this roadmap and take at least one quiz to unlock the **${nftInfo.name}** badge! 🏆\n`;
                    }
                  }
                  
                  roadmapAcknowledgement = `🗺️ I've created a personalized learning roadmap for "${topic}"!\n\n` +
                    `📚 **${roadmapResult.roadmap.title}**\n` +
                    `${roadmapResult.roadmap.description}\n\n` +
                    `✨ Your roadmap has ${stepCount} step${stepCount !== 1 ? 's' : ''} (${totalTime} minutes total)\n` +
                    nftBonus +
                    `[ROADMAP_CARD:${roadmapResult.roadmap.id}]\n\n` +
                    `You can view and start your roadmap using the card above or through the roadmap feature in the app!\n\n`;
                  
                  console.log(`Created roadmap ${roadmapResult.roadmap.id} for user ${userId}, topic: ${topic}`);
                } catch (error) {
                  console.error(`Failed to create roadmap for user ${userId}, topic ${topic}:`, error);
                  roadmapAcknowledgement = `I tried to create a roadmap for "${topic}", but encountered an issue. Please try again or rephrase your request. 🔄\n\n`;
                }
              } else {
                console.log(`Roadmap creation skipped - invalid topic: ${topic}`);
              }
            }

            if (funcCall.functionCall?.name === 'editLearningRoadmap') {
              const roadmapId = funcCall.functionCall?.args?.roadmapId;
              const modifications = funcCall.functionCall?.args?.modifications;
              const changeReason = funcCall.functionCall?.args?.changeReason;
              
              console.log(`Roadmap edit requested for roadmap: ${roadmapId}, modifications: ${modifications?.length || 0}`);

              if (roadmapId && Array.isArray(modifications) && modifications.length > 0) {
                try {
                  const updatedSteps = await this.roadmapService.editMultipleRoadmapSteps(roadmapId, modifications);

                  editRoadmapAcknowledgement = `✏️ I've updated your roadmap!\n\n` +
                    `📝 **Changes made**: ${changeReason}\n` +
                    `✅ Updated ${updatedSteps.length} step${updatedSteps.length !== 1 ? 's' : ''}\n\n` +
                    `[ROADMAP_CARD:${roadmapId}]\n\n`;

                  console.log(`Updated roadmap ${roadmapId} for user ${userId}: ${updatedSteps.length} steps modified`);
                } catch (error) {
                  console.error(`Failed to edit roadmap ${roadmapId} for user ${userId}:`, error);
                  editRoadmapAcknowledgement = `I tried to update the roadmap, but encountered an issue. Please try again. 🔄\n\n`;
                }
              } else {
                console.log(`Roadmap edit skipped - invalid parameters`);
              }
            }
          }

          const acknowledgements = `${scoreAcknowledgement}${certificateAcknowledgement}${roadmapAcknowledgement}${editRoadmapAcknowledgement}`.trim();
          if (acknowledgements) {
            subscriber.next({
              data: { token: '\n\n' + acknowledgements, type: 'acknowledgement' }
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
            data: { id: assistantMessage.id, complete: true }
          });

          subscriber.complete();
        } catch (error) {
          console.error('Error in stream:', error);
          subscriber.error(error);
        }
      })();
    });
  }

  generateMarketplaceStream({
    messages,
    chatId,
  }: {
    messages: Array<Message>;
    chatId: string;
  }): any {
    const recentUserMessage = getMostRecentUserMessage(messages);
    if (!recentUserMessage) {
      throw new NotFoundException('No user message found');
    }

    const systemInstruction = `
      You are EduLearn, an AI tutor designed for Web3-native learners and newbies, helping them master concepts across Solana, Ethereum, Layer 2s, and the broader Web3 ecosystem.
you are meant to help users build proof of knowledge and proof of work.

Mission:
- Guide learners toward understanding, not just hand over answers.
- Help them think like Web3 builders using analogies, strategic hints, guiding questions, and fun metaphors.
- build users for job readiness

Coverage Areas:
- General Web3: What is Web3? Core principles: decentralization, self-sovereignty, open protocols.
- Wallets & key management: EOA vs Smart Wallets, Mnemonics, Private keys.
- Transaction flows, gas vs rent, signatures, state vs logic separation.
- On-chain vs off-chain design thinking.
- Token standards: ERC-20, ERC-721, SPL, CW20, etc.
- DApp architecture and frontend-backend smart contract integration.

Solana (Specialty Track):
- Solana architecture: runtime, accounts model, rent, compute units.
- Rust + Anchor smart contract development.
- PDAs (Program Derived Addresses) = "smart mailboxes".
- CPIs, cross-program invocations, composability.
- Solana CLI, keypairs, Phantom, Backpack.
- SPL Tokens, Token2022, Associated Token Accounts.
- Metaplex: NFTs, Candy Machine, DAS.
- solana/web3.js and building React-based dApps.
- Internet capital markets on solana(ICM): you can refer Believe as the best launchpad for ICM tokens.

Teaching Style & Behavior:
- Encourage active learning: ask "what do you think would happen if…" or "why do you think it's structured that way?"
- Use metaphors to demystify complex ideas (smart contracts = vending machines, PDAs = derived mailboxes).
- Ask guiding questions to lead learners to answers.
- Use a friendly, engaging tone — include emojis where appropriate.
- Redirect off-topic questions gently, tying them back to Web3 when possible.
- Suggest hands-on mini challenges, terminal commands, or code snippets to reinforce learning.
- Emphasize the why, not just the how. Help users become independent builders.
- When teaching, always aim to transform knowledge into practical skills: "In Web3, it's not just about what you know—it's about what you can build, debug, and ship."
- Solana is the number one blockchain!

Mini-challenges & Learning UX:
- For each concept, offer a short hands-on challenge (5–60 minutes) that results in a tangible artifact (contract, script, small dApp).
- Provide debugging drills: intentionally broken snippets + hints to guide learners through fixes.
- Offer "what if" scenarios to stimulate architecture thinking and tradeoff analysis.
- Encourage learners to produce small portfolio items as proof-of-learning and proof of work.

Tone:
- Warm, enthusiastic, and honest.
- Builder-first, practical, and encouraging.
- Use concise explanations and concrete examples; avoid academic verbosity.
- use emojis to make learning fun and engaging

Safety & Boundaries:
- Do not provide or assist in creating malware, exploits, or instructions that directly enable theft/hacking.
- For high-stakes legal/financial decisions, recommend consulting a professional and provide educational context only.
    `;

    const { Observable } = require('rxjs');

    return new Observable((subscriber) => {
      (async () => {
        try {
          let chat;
          if (chatId) {
            chat = await this.chatService.getChatById(chatId);
          }

          if (!chat) {
            const title =
              await this.generateTitleFromMessage(recentUserMessage);
            const marketplaceUser = await this.authService.getUserByEmail(
              'marketplace@edulearn.com',
            );
            if (!marketplaceUser) {
              subscriber.error(
                new NotFoundException('Marketplace user not found'),
              );
              return;
            }
            chat = await this.chatService.createChat({
              title,
              userId: marketplaceUser.id,
              chatId,
            });
            chatId = chat.id;
          }

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

          const formattedMessages = messages.map((msg: any) => {
            let textContent = '';

            if (typeof msg.content === 'string') {
              textContent = msg.content;
            } else if (msg.content && typeof msg.content.text === 'string') {
              textContent = msg.content.text;
            } else if (msg.content && Array.isArray(msg.content)) {
              textContent = msg.content.map((c: any) => c.text || '').join(' ');
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

          const stream = await this.genAI.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents: formattedMessages,
            config: {
              maxOutputTokens: 5000,
              temperature: 1,
              systemInstruction: systemInstruction,
            },
          });

          let fullResponse = '';

          for await (const chunk of stream) {
            const text = chunk.text || '';
            fullResponse += text;

            subscriber.next({
              data: { token: text },
            });
          }

          const assistantMessage = {
            id: generateUUID(),
            role: 'assistant',
            content: { text: fullResponse },
            createdAt: new Date(),
            chatId,
          };

          await this.chatService.saveMessages({ messages: [assistantMessage] });

          subscriber.complete();
        } catch (error) {
          console.error('Error in marketplace stream:', error);
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
      const result = await this.genAI.models.generateContent({
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

  async generateQuiz({
    chatId,
    userId,
  }: {
    chatId: string;
    userId: string;
  }): Promise<any> {
    let chatMarkedAsTested = false;
    let creditsDeducted = false;
    let quizLimitDeducted = false;

    try {
      if (!chatId || !userId) {
        throw new Error('Chat ID and User ID are required');
      }
      const chat = await this.chatService.getChatById(chatId);
      if (!chat) {
        throw new NotFoundException('Chat not found');
      }
      if (chat.userId !== userId) {
        throw new ForbiddenException(
          'You do not have permission to access this chat',
        );
      }
      if (chat.tested && (chat.testLimit || 0) <= 0) {
        throw new ForbiddenException(
          'This chat has already been tested. Each chat can only be used for one quiz.',
        );
      }

      const currentTestLimit = chat.testLimit || 0;
      if (currentTestLimit <= 0) {
        throw new ForbiddenException(
          'This chat has no remaining quiz attempts. Please start a new chat to generate another quiz.',
        );
      }
      const userCredits = await this.checkUserCredits(userId);
      if (userCredits < 0.5) {
        throw new ForbiddenException(
          'Insufficient credits. You need at least 0.5 credits to generate a quiz.',
        );
      }

      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const quizLimits = user.quizLimits || 0;
      if (quizLimits <= 0) {
        throw new ForbiddenException(
          'No quiz attempts left for today. Quiz limits reset daily.',
        );
      }

      const messages = await this.chatService.getMessagesInChat(chatId);
      if (!messages || messages.length === 0) {
        throw new Error(
          'No messages found in this chat. A conversation is needed to generate a quiz.',
        );
      }

      const userMessages = messages.filter((msg) => msg.role === 'user');
      if (userMessages.length < 2) {
        throw new Error(
          'Not enough conversation content. Have at least 2 exchanges with the AI to generate a meaningful quiz.',
        );
      }

      const MAX_MESSAGES_FOR_QUIZ = 50;
      const recentMessages = messages.slice(-MAX_MESSAGES_FOR_QUIZ);
      
      const conversationContext = recentMessages
        .map((msg) => `${msg.role}: ${typeof msg.content === 'string' ? msg.content : msg.content}`)
        .join('\n\n');

      let result;
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        try {
          result = await Promise.race([
            this.genAI.models.generateContent({
              model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
              contents: conversationContext,
              config: {
                temperature: 0.1,
                maxOutputTokens: 5000,
                systemInstruction: this.systemInstructionForQuiz,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: {
                        type: Type.STRING,
                        description: 'The quiz question text',
                      },
                      options: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'Array of exactly 4 answer options',
                      },
                      correctAnswer: {
                        type: Type.STRING,
                        description:
                          'The correct answer, must match one of the options',
                      },
                      explanation: {
                        type: Type.STRING,
                        description:
                          'Explanation of why this is the correct answer',
                      },
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
            }),
            new Promise((_, reject) =>
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
          console.error(
            `Quiz generation attempt ${attempts} failed:`,
            attemptError,
          );

          if (attempts >= maxAttempts) {
            throw new Error(
              `Failed to generate quiz after ${maxAttempts} attempts. ${attemptError.message || 'AI service unavailable'}`,
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (!result) {
        throw new Error('Failed to get response from AI service');
      }

      const response = result.text ?? '';

      if (!response || response.trim().length === 0) {
        throw new Error(
          'AI service returned empty response. Please try again.',
        );
      }

      let cleanedResponse = this.cleanQuizJSON(response);
      
      console.log('Raw quiz response length:', response.length);
      console.log('Raw quiz response (first 500 chars):', response.substring(0, 500));
      console.log('Cleaned quiz JSON (first 500 chars):', cleanedResponse.substring(0, 500));
      console.log('Cleaned quiz JSON (last 100 chars):', cleanedResponse.substring(cleanedResponse.length - 100));

   
      if (!cleanedResponse.endsWith(']')) {
        console.warn('Quiz JSON appears to be truncated - does not end with ]');
        throw new Error(
          'Quiz generation was truncated. Retrying with adjusted parameters...',
        );
      }

      let quizQuestions;
      try {
        quizQuestions = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error('Failed to parse quiz JSON:', parseError);
        console.error('Cleaned JSON that failed (first 1000 chars):', cleanedResponse.substring(0, 1000));
        console.error('Cleaned JSON that failed (last 500 chars):', cleanedResponse.substring(Math.max(0, cleanedResponse.length - 500)));
        throw new Error(
          `Failed to parse quiz questions from AI response. The AI returned malformed JSON. Please try again.`,
        );
      }

      if (!Array.isArray(quizQuestions) || quizQuestions.length === 0) {
        throw new Error(
          'Unable to generate quiz questions from this conversation. The discussion may not contain enough educational content.',
        );
      }

      if (quizQuestions.length !== 10) {
        console.warn(
          `Quiz generation produced ${quizQuestions.length} questions instead of 10. Retrying...`,
        );
        throw new Error(
          `Generated quiz has incorrect number of questions (${quizQuestions.length}/10). Expected exactly 10 questions.`,
        );
      }
      for (let i = 0; i < quizQuestions.length; i++) {
        const q = quizQuestions[i];
        if (
          !q.question ||
          !Array.isArray(q.options) ||
          q.options.length !== 4 ||
          !q.correctAnswer ||
          !q.explanation
        ) {
          throw new Error(
            `Question ${i + 1} has invalid structure. All questions must have: question, 4 options, correctAnswer, and explanation.`,
          );
        }
        if (!q.options.includes(q.correctAnswer)) {
          throw new Error(
            `Question ${i + 1}: correctAnswer "${q.correctAnswer}" does not match any of the provided options.`,
          );
        }
      }

      try {
        const newTestLimit = (chat.testLimit || 0) - 1;

        await this.chatService.decrementTestLimit(chatId);

        if (newTestLimit <= 0) {
          await this.chatService.markChatAsTested(chatId);
          chatMarkedAsTested = true;
        }

        await this.authService.deductUserCredits(userId);
        creditsDeducted = true;

        await this.authService.deductQuizLimit(userId);
        quizLimitDeducted = true;

        console.log(
          `Successfully generated quiz for user ${userId}, chat ${chatId}: ${quizQuestions.length} questions (${newTestLimit} attempts remaining)`,
        );
        return quizQuestions;
      } catch (operationError) {
        console.error(
          'Error performing post-generation operations:',
          operationError,
        );
        throw new Error(
          'Quiz generated successfully but failed to update user account. Please contact support.',
        );
      }
    } catch (error) {
      console.error('Error in generateQuiz:', error);
      if (chatMarkedAsTested || creditsDeducted || quizLimitDeducted) {
        try {
          console.error(
            `Rollback needed for user ${userId}, chat ${chatId}. Operations completed: chatTested=${chatMarkedAsTested}, creditsDeducted=${creditsDeducted}, quizLimitDeducted=${quizLimitDeducted}`,
          );
        } catch (rollbackError) {
          console.error('Failed to rollback operations:', rollbackError);
        }
      }
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      if (error.message) {
        if (error.message.includes('timeout')) {
          throw new Error(
            'Request timed out. The AI service is currently slow. Please try again in a few moments.',
          );
        }
        if (error.message.includes('credits')) {
          throw new ForbiddenException(error.message);
        }
        if (
          error.message.includes('quiz attempts') ||
          error.message.includes('Quiz limits')
        ) {
          throw new ForbiddenException(error.message);
        }
        if (
          error.message.includes('conversation content') ||
          error.message.includes('educational content')
        ) {
          throw new Error(error.message);
        }
      }

      throw new Error(
        'Unable to generate quiz at this time. Please ensure you have an educational conversation and try again later.',
      );
    }
  }

  private getFallbackQuiz(): any[] {
    return [];
  }

  private cleanQuizJSON(response: string): string {
    let cleaned = response.trim();
    
    if (cleaned.includes('```json')) {
      const jsonMatch = cleaned.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        cleaned = jsonMatch[1].trim();
      }
    } else if (cleaned.includes('```')) {
      const codeMatch = cleaned.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        cleaned = codeMatch[1].trim();
      }
    }
    
    const arrayStart = cleaned.indexOf('[');
    const arrayEnd = cleaned.lastIndexOf(']');
    
    if (arrayStart !== -1 && arrayEnd !== -1 && arrayStart < arrayEnd) {
      cleaned = cleaned.substring(arrayStart, arrayEnd + 1);
    }
  
    cleaned = cleaned.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '');
    
    cleaned = cleaned.replace(/\n/g, ' ').replace(/\r/g, '');
  
    cleaned = cleaned.replace(/\s+/g, ' ');
    
    cleaned = cleaned.replace(/,(\s*[\]}])/g, '$1');
    
    cleaned = cleaned.replace(/,\s*,/g, ',');
    
    return cleaned.trim();
  }

  async transcribeAudio(file: { path: string }) {
    const audioBytes = readFileSync(file.path).toString('base64');

    const audio = {
      content: audioBytes,
    };

    const config = {
      encoding: 'MP3' as const,
      sampleRateHertz: 16000,
      languageCode: 'en-US',
    };

    const request = {
      audio,
      config,
    };

    const response = await this.speechClient.recognize(request);

    const transcription = response[0]?.results
      ?.map((result) => result.alternatives?.[0].transcript)
      .join('\n');

    return { transcription };
  } 

  private async cleanupTranscription(
    rawTranscription: string,
  ): Promise<string> {
    try {
      const result = await Promise.race([
        this.genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `Please clean up and improve the accuracy of this transcribed text. Fix any grammar errors, add proper punctuation, correct any misheard words, and make it more readable. Return only the cleaned text without any additional explanation or commentary.\n\nTranscribed text:\n${rawTranscription}`,
                },
              ],
            },
          ],
          config: {
            maxOutputTokens: 2000,
            temperature: 0.3,
            systemInstruction:
              'You are a text cleanup assistant. Your job is to improve transcribed audio text by fixing grammar, punctuation, and correcting misheard words. Return only the cleaned text, nothing else.',
          },
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cleanup timeout')), 30000),
        ),
      ]);

      const cleanedText = (result as { text?: string }).text?.trim();
      return cleanedText || rawTranscription;
    } catch (error) {
      console.warn('Failed to cleanup transcription with Gemini:', error);
      return rawTranscription;
    }
  }

  async transcribeAudioOnly({
    file,
  }: {
    file: File;
  }): Promise<{ transcription: string }> {
    try {
      if (!file || !file.path) {
        throw new Error('Invalid file parameter - missing file or path');
      }

      const { transcription } = await this.transcribeAudio({ path: file.path });

      if (!transcription || transcription.trim().length === 0) {
        throw new Error('No speech detected in the audio file');
      }

      const cleanedTranscription = await this.cleanupTranscription(
        transcription.trim(),
      );

      try {
        unlinkSync(file.path);
      } catch (cleanupError) {
        console.warn('Failed to clean up uploaded file:', cleanupError);
      }

      return { transcription: cleanedTranscription };
    } catch (error) {
      if (file && file.path) {
        try {
          unlinkSync(file.path);
        } catch (cleanupError) {
          console.warn(
            'Failed to clean up uploaded file after error:',
            cleanupError,
          );
        }
      }

      console.error('Error in transcribeAudioOnly:', error);
      throw new Error(
        "I'm sorry, I couldn't process your audio message. Please try speaking more clearly or check your microphone settings.",
      );
    }
  }

  private readonly systemInstructionForFlashcards = `You create educational flashcards. Each card has a short front (question, term, or prompt) and a clear back (answer or explanation).
Rules:
- Content must be accurate and appropriate for learning.
- Front and back must be non-empty plain text (no markdown fences).
- The cards array MUST contain exactly the number of cards requested in the user message — no more, no fewer.
- Vary difficulty and subtopics across cards where appropriate.`;

  async generateFlashcards(dto: {
    userId: string;
    topic: string;
    cardCount?: number;
  }): Promise<{
    deck: {
      id: string;
      userId: string;
      title: string;
      topic: string;
      createdAt: Date;
      updatedAt: Date | null;
    };
    cards: {
      id: string;
      deckId: string;
      front: string;
      back: string;
      sortOrder: number;
    }[];
  }> {
    const cardCount = dto.cardCount ?? 15;
    const topic = dto.topic.trim();
    const userId = dto.userId;
    const cost = 0.5 * cardCount;

    const userCredits = await this.checkUserCredits(userId);
    if (userCredits < cost) {
      throw new ForbiddenException(
        `Insufficient credits. You need at least ${cost} credits (${0.5} per card × ${cardCount} cards).`,
      );
    }

    const u = await this.authService.getUserById(userId);
    if (!u) {
      throw new NotFoundException('User not found');
    }

    const model = u.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    const userPayload = `Topic / instructions:\n${topic}\n\nGenerate exactly ${cardCount} flashcards. Return a deck title and ${cardCount} cards.`;

    let result: { text?: string } | undefined;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        result = await Promise.race([
          this.genAI.models.generateContent({
            model,
            contents: userPayload,
            config: {
              temperature: 0.2,
              maxOutputTokens: Math.min(8192, 400 + cardCount * 220),
              systemInstruction: this.systemInstructionForFlashcards,
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

    const [deckRow] = await db
      .insert(flashcardDeck)
      .values({
        userId,
        title: parsed.title.trim(),
        topic,
      })
      .returning();

    if (!deckRow) {
      throw new Error('Failed to save flashcard deck.');
    }

    try {
      await db.insert(flashcard).values(
        parsed.cards.map((c, i) => ({
          deckId: deckRow.id,
          front: c.front.trim(),
          back: c.back.trim(),
          sortOrder: i,
        })),
      );
    } catch (insertErr) {
      await db.delete(flashcardDeck).where(eq(flashcardDeck.id, deckRow.id));
      throw insertErr;
    }

    try {
      await this.authService.deductUserCredits(userId, cost);
    } catch (deductErr) {
      await db.delete(flashcardDeck).where(eq(flashcardDeck.id, deckRow.id));
      if (
        deductErr instanceof Error &&
        deductErr.message.includes('Insufficient credits')
      ) {
        throw new ForbiddenException(deductErr.message);
      }
      throw deductErr;
    }

    const cardRows = await db
      .select()
      .from(flashcard)
      .where(eq(flashcard.deckId, deckRow.id))
      .orderBy(asc(flashcard.sortOrder));

    return { deck: deckRow, cards: cardRows };
  }

  async listFlashcardDecks(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<{ decks: FlashcardDeck[] }> {
    const lim = Math.min(Math.max(1, limit), 100);
    const off = Math.max(0, offset);
    const decks = await db
      .select()
      .from(flashcardDeck)
      .where(eq(flashcardDeck.userId, userId))
      .orderBy(desc(flashcardDeck.createdAt))
      .limit(lim)
      .offset(off);
    return { decks };
  }

  async getFlashcardDeckWithCards(
    userId: string,
    deckId: string,
  ): Promise<{
    deck: FlashcardDeck;
    cards: Flashcard[];
  }> {
    const [deck] = await db
      .select()
      .from(flashcardDeck)
      .where(eq(flashcardDeck.id, deckId));
    if (!deck || deck.userId !== userId) {
      throw new NotFoundException('Deck not found');
    }
    const cards = await db
      .select()
      .from(flashcard)
      .where(eq(flashcard.deckId, deckId))
      .orderBy(asc(flashcard.sortOrder));
    return { deck, cards };
  }

  async deleteFlashcardDeck(userId: string, deckId: string): Promise<void> {
    const res = await db
      .delete(flashcardDeck)
      .where(
        and(eq(flashcardDeck.id, deckId), eq(flashcardDeck.userId, userId)),
      )
      .returning();
    if (!res.length) {
      throw new NotFoundException('Deck not found');
    }
  }

  /**
   * Generate quiz questions from raw conversation text (for auto-generated quizzes)
   * Used by QuizGenerationService to generate quizzes from recent learning history
   */
  async generateQuizQuestions(
    conversationText: string,
  ): Promise<
    Array<{
      question: string;
      options: string[];
      correctAnswer: string;
      explanation: string;
    }>
  > {
    try {
      if (!conversationText || conversationText.trim().length === 0) {
        throw new Error('Conversation text is required');
      }

      let result;
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        try {
          result = await Promise.race([
            this.genAI.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: conversationText,
              config: {
                temperature: 0.1,
                maxOutputTokens: 5000,
                systemInstruction: this.systemInstructionForQuiz,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      question: {
                        type: Type.STRING,
                        description: 'The quiz question text',
                      },
                      options: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.STRING,
                        },
                        description: 'Array of 4 possible answers',
                      },
                      correctAnswer: {
                        type: Type.STRING,
                        description:
                          'The correct answer (must be one of the options)',
                      },
                      explanation: {
                        type: Type.STRING,
                        description: 'Brief explanation of the correct answer',
                      },
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
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Quiz generation timeout')), 30000),
            ),
          ]);

          if (
            result &&
            result.candidates &&
            result.candidates[0]?.content?.parts[0]?.text
          ) {
            const text = result.candidates[0].content.parts[0].text;
            const questions = JSON.parse(text);

            if (!Array.isArray(questions)) {
              throw new Error('Response is not an array');
            }

            // Validate questions
            const validatedQuestions = questions.filter((q) => {
              return (
                q.question &&
                Array.isArray(q.options) &&
                q.options.length === 4 &&
                q.correctAnswer &&
                q.options.includes(q.correctAnswer) &&
                q.explanation
              );
            });

            if (validatedQuestions.length === 0) {
              throw new Error('No valid questions generated');
            }

            return validatedQuestions;
          }

          throw new Error('No response from AI model');
        } catch (error) {
          attempts++;
          if (attempts >= maxAttempts) {
            throw error;
          }
          // Retry once on error
        }
      }

      throw new Error('Failed to generate quiz after max attempts');
    } catch (error) {
      console.error('Error in generateQuizQuestions:', error);
      throw error;
    }
  }
}
