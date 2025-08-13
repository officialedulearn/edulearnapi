import { GoogleGenAI, Type } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Message } from 'lib/db/schema';
import { getMostRecentUserMessage } from 'lib/utils';
import { AuthService } from 'src/auth/auth.service';
import { ChatService } from 'src/chat/chat.service';
import { generateUUID } from 'lib/utils';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ActivityService } from 'src/activity/activity.service';

@Injectable()
export class AiService {
  private readonly genAI: GoogleGenAI;
  private readonly systemInstruction = `
You are EduLearn, an AI tutor designed for Web3-native learners, helping them master concepts across Solana, Ethereum, Layer 2s, and the broader Web3 ecosystem.

Mission:
- Guide learners toward understanding, not just hand over answers.
- Help them think like Web3 builders using analogies, strategic hints, guiding questions, and fun metaphors.

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

Ethereum + EVM:
- Solidity, Truffle, Hardhat, Foundry.
- Gas optimization, storage layouts, reentrancy and security.
- Layer 2s: Arbitrum, Optimism, zkSync, Starknet.
- ERC standards and contract inheritance.
- Wallets: MetaMask, Rainbow, Frame.

Other Ecosystems:
- Cosmos SDK, Tendermint, IBC.
- Polkadot/Substrate.
- Near, Aptos, Sui (Move).
- Bitcoin Layer 2s: Stacks, Ordinals, Lightning.
- Account Abstraction, AA Wallets, Passkeys.

Teaching Style & Behavior:
- Encourage active learning: ask "what do you think would happen if…" or "why do you think it's structured that way?"
- Use metaphors to demystify complex ideas (smart contracts = vending machines, PDAs = derived mailboxes).
- Ask guiding questions to lead learners to answers.
- Use a friendly, engaging tone — include emojis where appropriate.
- Redirect off-topic questions gently, tying them back to Web3 when possible.
- Suggest hands-on mini challenges, terminal commands, or code snippets to reinforce learning.
- Emphasize the why, not just the how. Help users become independent builders.
- When teaching, always aim to transform knowledge into practical skills: "In Web3, it's not just about what you know—it's about what you can build, debug, and ship."

Mini-challenges & Learning UX:
- For each concept, offer a short hands-on challenge (5–60 minutes) that results in a tangible artifact (contract, script, small dApp).
- Provide debugging drills: intentionally broken snippets + hints to guide learners through fixes.
- Offer "what if" scenarios to stimulate architecture thinking and tradeoff analysis.
- Encourage learners to produce small portfolio items as proof-of-learning.

Tone:
- Warm, enthusiastic, and honest.
- Builder-first, practical, and encouraging.
- Use concise explanations and concrete examples; avoid academic verbosity.

Safety & Boundaries:
- Do not provide or assist in creating malware, exploits, or instructions that directly enable theft/hacking.
- For high-stakes legal/financial decisions, recommend consulting a professional and provide educational context only.

`;

  private readonly systemInstructionForQuiz = `Based on the context of our conversation so far, generate 5 quiz questions to test my understanding — but only if the discussion included web3 learning-based content. If the conversation was casual or unrelated to learning, return an empty array.

All questions should be medium difficulty (level 6 on a scale of 1 to 10), with 4 options and only one correct answer.

Format the output strictly as a JSON array with this structure:
[
  {
    "question": "the question text",
    "options": ["option1", "option2", "option3", "option4"],
    "correctAnswer": "the correct option",
    "explanation": "explanation of the answer"
  },
  ...more questions
]

Do not include any explanation or additional text outside the JSON array.`;

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
    name: "giveACertificate",
    description: "from your interaction with the user, if you think they have learned something valuable, give them one of these certificates that matches what they learned: 'web3 basics': "
  }
  constructor(
    private chatService: ChatService,
    private authService: AuthService,
  ) {
    const aiApiKey = process.env.GEMINI_API_KEY;
    if (!aiApiKey) {
      throw new Error('AI API Key is not configured');
    }
    this.genAI = new GoogleGenAI({
      apiKey: aiApiKey,
    });
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
      
      // Add timeout to prevent hanging requests
      const result = await Promise.race([
        this.genAI.models.generateContent({
          model: 'gemini-2.0-flash',
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
          setTimeout(() => reject(new Error('Request timeout')), 10000)
        )
      ]);

      const titleResponse = (result as { text?: string }).text?.trim();
      return titleResponse || 'Untitled Chat';
    } catch (error) {
      console.error('Error generating title:', error);
      
      // Fallback title generation logic that doesn't require API
      try {
        const words = String(message.content).split(' ');
        const shortTitle = words.slice(0, 5).join(' ');
        return shortTitle.length > 30 ? `${shortTitle.substring(0, 30)}...` : shortTitle || 'Untitled Chat';
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
      // Check if user has enough credits before proceeding
      const userCredits = await this.checkUserCredits(userId);
      if (userCredits < 0.5) {
        // User doesn't have enough credits
        const outOfCreditsMessage = {
          id: generateUUID(),
          role: 'assistant',
          content: { 
            text: "You've run out of credits! To continue using EduLearn AI, please purchase $EDLN tokens to get more credits or upgrade your plan in the app settings. Premium users get more daily credits and additional benefits." 
          },
          createdAt: new Date(),
          chatId,
        };
        
        await this.chatService.saveMessages({ messages: [outOfCreditsMessage] });
        return outOfCreditsMessage;
      }

      const formattedMessages = messages.map((msg: any) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [
          {
            text:
              typeof msg.content === 'string' ? msg.content : msg.content.text,
          },
        ],
      }));

      // Add timeout to prevent hanging requests
      const result = await Promise.race([
        this.genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: formattedMessages,
          config: {
            tools: [{ functionDeclarations: [this.scoreUser] }],
            maxOutputTokens: 3000,
            temperature: 1,
            systemInstruction: this.systemInstruction,
          },
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Request timeout')), 15000)
        )
      ]);

      await this.authService.deductUserCredits(userId);

      const candidate = (result as { candidates?: Array<{ content?: { parts: Array<{ text?: string; functionCall?: { name: string; args: any } }> } }> }).candidates?.[0];
      const parts = candidate?.content?.parts || [];

      const responseText = parts
        .filter((part: any) => typeof part.text === 'string')
        .map((part: any) => part.text)
        .join('')
        .trim();

      const functionPart = parts.find(
        (part: any) => part.functionCall?.name === 'scoreUser',
      );
      let score = 0;
      let scoreAcknowledgement = '';

      if (functionPart) {
        score = Number(functionPart.functionCall?.args?.score || 0);
        if (!isNaN(score) && score > 0) {
          await this.authService.updateUserXP(userId, chat.title, score, 'chat');
          scoreAcknowledgement = `✅ Great job! I've awarded you ${score} point${score !== 1 ? 's' : ''} for your answer 🎉\n\n`;
        }
      }

      const fullResponse = `${scoreAcknowledgement}${responseText}`.trim();
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
      
      // Fallback response when API is unreachable
      const fallbackResponse = {
        id: generateUUID(),
        role: 'assistant',
        content: { 
          text: "I'm sorry, but I'm having trouble connecting to my knowledge base at the moment. " +
                "This could be due to network connectivity issues. Please check your internet connection " +
                "and try again in a few moments." 
        },
        createdAt: new Date(),
        chatId,
      };
      
      await this.chatService.saveMessages({ messages: [fallbackResponse] });
      
      return fallbackResponse;
    }
  }

  async generateQuiz({
    chatId,
    userId,
  }: {
    chatId: string;
    userId: string;
  }): Promise<any> {
    const chat = await this.chatService.getChatById(chatId);
    if (!chat) {
      throw new NotFoundException('Chat not found');
    }
    if (chat.userId !== userId) {
      throw new ForbiddenException('Unauthorized');
    }
    if (chat.tested) {
      throw new ForbiddenException('This chat has already been tested.');
    }

    const messages = await this.chatService.getMessagesInChat(chatId);

    const formattedMessages = messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [
        { text: typeof msg.content === 'string' ? msg.content : msg.content },
      ],
    }));

    const result = await this.genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: `Our conversation: ${JSON.stringify(formattedMessages)}`,
      config: {
        temperature: 0.2,
        maxOutputTokens: 2048,
        systemInstruction: this.systemInstructionForQuiz,
      },
    });

    await this.chatService.markChatAsTested(chatId)
    await this.authService.deductUserCredits(userId);

    const response = result.text ?? '';
    let jsonStr = response;
    if (response.includes('```json')) {
      jsonStr = response.split('```json')[1].split('```')[0].trim();
    } else if (response.includes('```')) {
      jsonStr = response.split('```')[1].split('```')[0].trim();
    }

    try {
      const quizQuestions = JSON.parse(jsonStr);
      return quizQuestions;
    } catch (jsonError) {
      console.error('Error parsing JSON from model response:', jsonError);
      throw new Error('Failed to generate valid quiz questions');
    }
  }
}
