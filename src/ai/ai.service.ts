import { GoogleGenAI, Type } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { Message } from 'lib/db/schema';
import { getMostRecentUserMessage } from 'lib/utils';
import { AuthService } from 'src/auth/auth.service';
import { ChatService } from 'src/chat/chat.service';
import { generateUUID } from 'lib/utils';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ActivityService } from 'src/activity/activity.service';
import { RewardsService } from 'src/rewards/rewards.service';
import { SpeechClient } from '@google-cloud/speech';
import { readFileSync, unlinkSync } from 'fs';
import { Express } from 'express';
import type { File } from 'multer';


//add icm knowledge

@Injectable()
export class AiService {
  private readonly genAI: GoogleGenAI;
  private readonly speechClient: SpeechClient;
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

YOU MUST ALWAYS GENERATE 5 QUESTIONS

Do not include any explanation or additional text outside the JSON array.`;

  private readonly rewards = {
    web3Basics: "4c5d895a-3479-481a-9db6-4327f6ae53cd",
  }

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
    description: "ONLY give a certificate when the user has CLEARLY demonstrated deep understanding of a topic through multiple interactions. The user must have asked thoughtful questions AND correctly answered your questions AND engaged meaningfully with the topic over multiple exchanges. Available certificates: 'web3 Basics'. NEVER give certificates for basic questions or simple interactions - the standard must be high.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        certificate: {
          type: Type.STRING,
          description: "The certificate type to give the user. Must be one of: 'web3Basics'",
          enum: ["web3Basics"]
        },
        confidenceLevel: {
          type: Type.NUMBER,
          description: "Your confidence (1-10) that the user truly understands this topic deeply. ONLY award certificates when confidence is 8 or higher.",
        }
      },
      required: ['certificate', 'confidenceLevel'],  
    }
  }
  constructor(
    private chatService: ChatService,
    private authService: AuthService,
    private rewardsService: RewardsService,
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
        private_key_id: process.env.GOOGLE_APPLICATION_CREDENTIALS_PRIVATE_KEY_ID,
        private_key: process.env.GOOGLE_APPLICATION_CREDENTIALS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_APPLICATION_CREDENTIALS_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_APPLICATION_CREDENTIALS_CLIENT_ID,
      },
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
          setTimeout(() => reject(new Error('Request timeout')), 10000)
        )
      ]);

      const titleResponse = (result as { text?: string }).text?.trim();
      return titleResponse || 'Untitled Chat';
    } catch (error) {
      console.error('Error generating title:', error);
      
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
    const user = await this.authService.getUserById(userId);

    if (!user?.isPremium) {
      const existingMessages = await this.chatService.getMessagesInChat(chatId);
      const messageCount = existingMessages.length;
      
      if (messageCount >= 30) {
        const messageLimitMessage = {
          id: generateUUID(),
          role: 'assistant',
          content: { 
            text: "🚀 You've reached the 30 message limit for this chat! To continue learning:\n\n✨ **Upgrade to Premium** for unlimited messages and exclusive features\n🆕 **Start a new chat** to continue with your free plan\n\nPremium users get unlimited messages, priority support, and access to advanced AI models. Upgrade now to unlock your full learning potential! 🎓" 
          },
          createdAt: new Date(),
          chatId,
        };
        
        await this.chatService.saveMessages({ messages: [messageLimitMessage] });
        return messageLimitMessage;
      }
    }

    const systemInstruction = `
      You are EduLearn, an AI tutor designed for Web3-native learners and newbies, helping them master concepts across Solana, Ethereum, Layer 2s, and the broader Web3 ecosystem.
you are meant to help users build proof of knowledge and proof of work.

the user's name: ${user?.name}
the user wants to master: ${user?.learning}
and the users current level on the app is: ${user?.level}


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
- Encourage learners to produce small portfolio items as proof-of-learning and proof of work .

Tone:
- Warm, enthusiastic, and honest.
- Builder-first, practical, and encouraging.
- Use concise explanations and concrete examples; avoid academic verbosity.
- use emojis to make learning fun and engaging

Safety & Boundaries:
- Do not provide or assist in creating malware, exploits, or instructions that directly enable theft/hacking.
- For high-stakes legal/financial decisions, recommend consulting a professional and provide educational context only.


    `

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

      const result = await Promise.race([
        this.genAI.models.generateContent({
          model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
          contents: formattedMessages,
          config: {
            tools: [{ functionDeclarations: [this.scoreUser, this.rewardUser] }],
            maxOutputTokens: 3000,
            temperature: 1,
            systemInstruction: systemInstruction,
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
      
      const certificatePart = parts.find(
        (part: any) => part.functionCall?.name === 'giveACertificate',
      );
      
      let score = 0;
      let scoreAcknowledgement = '';
      let certificateAcknowledgement = '';

      if (functionPart) {
        score = Number(functionPart.functionCall?.args?.score || 0);
        if (!isNaN(score) && score > 0) {
          await this.authService.updateUserXP(userId, chat.title, score, 'chat');
          scoreAcknowledgement = `✅ Great job! I've awarded you ${score} point${score !== 1 ? 's' : ''} for your answer 🎉\n\n`;
        }
      }
      
      if (certificatePart) {
        const certificateType = certificatePart.functionCall?.args?.certificate;
        const confidenceLevel = Number(certificatePart.functionCall?.args?.confidenceLevel || 0);
        console.log(`Certificate type requested: ${certificateType} with confidence level: ${confidenceLevel}`);
        
        if (certificateType && this.rewards[certificateType] && confidenceLevel >= 8) {
          try {
            const rewardId = this.rewards[certificateType];
            await this.rewardsService.awardRewardToUser(userId, rewardId);
            
            certificateAcknowledgement = `🏆 Congratulations! You've earned a ${certificateType} certificate! You can view and claim it in your rewards section 🎓\n\n`;
            console.log(`Awarded certificate ${certificateType} (${rewardId}) to user ${userId} with confidence level ${confidenceLevel}`);
          } catch (error) {
            if (error.message && error.message.includes('already has this reward')) {
              certificateAcknowledgement = `You've already earned the ${certificateType} certificate! You can view it in your rewards section 🎓\n\n`;
              console.log(`User ${userId} already has the ${certificateType} certificate`);
            } else {
              console.error(`Failed to award ${certificateType} certificate to user ${userId}:`, error);
            }
          }
        } else {
          console.log(`Certificate request denied - confidence level ${confidenceLevel} is below threshold (8)`);
        }
      }

      const fullResponse = `${scoreAcknowledgement}${certificateAcknowledgement}${responseText}`.trim();
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

  async generateSuggestions({userId}: {userId: string}) {
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
- Each suggestion: 3 words, study-focused, relevant, engaging
- Focus on understanding, not actions

YOU MUST ALWAYS GENERATE 3 SUGGESTIONS

Output:
Return ONLY a valid JSON array of exactly 3 strings. No markdown, no explanations, no additional text.
Example format: ["topic one", "topic two", "topic three"]
`;
    try {
      const result = await this.genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Generate 3 personalized learning suggestions for a ${userLevel} level user interested in ${userLearning} with ${user.xp} XP points.`,
        config: {
          maxOutputTokens: 300,
          temperature: 0.7,
          systemInstruction: systemInstruction,
        }
      });

      const responseText = result.text?.trim();
      if (!responseText) {
        throw new Error('Empty response from AI');
      }
      let jsonStr = this.extractAndCleanJSON(responseText);
      
      if (!jsonStr) {
        console.error('No valid JSON found in AI response:', responseText);
        throw new Error('AI service returned invalid format for suggestions');
      }

      let suggestions;
      try {
        suggestions = JSON.parse(jsonStr);
      } catch (parseError) {
        console.error('JSON parsing failed for suggestions:', parseError);
        console.error('Attempted to parse:', jsonStr);

        try {
          const fixedJson = this.attemptJSONFix(jsonStr);
          if (fixedJson) {
            suggestions = JSON.parse(fixedJson);
            console.log('Fixed JSON:', fixedJson);
          } else {
            throw parseError;
          }
        } catch (secondError) {
          console.error('Second parsing attempt failed:', secondError);
          throw parseError;
        }
      }
      
      if (!Array.isArray(suggestions) || suggestions.length !== 3) {
        console.error('Invalid suggestions format:', suggestions);
        throw new Error('Invalid suggestions format - expected array of 3 strings');
      }

      return suggestions;
    } catch (error) {
      console.error('Error generating suggestions:', error);
      
      const fallbackSuggestions = {
        novice: [
          "solana consensus basics",
          "wallet security fundamentals", 
          "ICM market concepts"
        ],
        beginner: [
          "anchor framework study",
          "ICM trading principles",
          "SPL token mechanics"
        ],
        intermediate: [
          "solana PDA concepts",
          "ICM protocol analysis",
          "compute units explained"
        ],
        advanced: [
          "ICM yield strategies",
          "anchor optimization patterns",
          "cross-program invocations"
        ],
        expert: [
          "ICM protocol design",
          "solana performance tuning",
          "advanced ICM applications"
        ]
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
        throw new ForbiddenException('You do not have permission to access this chat');
      }
      if (chat.tested) {
        throw new ForbiddenException('This chat has already been tested. Each chat can only be used for one quiz.');
      }
      const userCredits = await this.checkUserCredits(userId);
      if (userCredits < 0.5) {
        throw new ForbiddenException('Insufficient credits. You need at least 0.5 credits to generate a quiz.');
      }

      const user = await this.authService.getUserById(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }
      
      const quizLimits = user.quizLimits || 0;
      if (quizLimits <= 0) {
        throw new ForbiddenException('No quiz attempts left for today. Quiz limits reset daily.');
      }

      const messages = await this.chatService.getMessagesInChat(chatId);
      if (!messages || messages.length === 0) {
        throw new Error('No messages found in this chat. A conversation is needed to generate a quiz.');
      }

      const userMessages = messages.filter(msg => msg.role === 'user');
      if (userMessages.length < 2) {
        throw new Error('Not enough conversation content. Have at least 2 exchanges with the AI to generate a meaningful quiz.');
      }

      const formattedMessages = messages.map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [
          { text: typeof msg.content === 'string' ? msg.content : msg.content },
        ],
      }));

      let result;
      let attempts = 0;
      const maxAttempts = 2;

      while (attempts < maxAttempts) {
        try {
          result = await Promise.race([
            this.genAI.models.generateContent({
              model: user?.isPremium ? 'gemini-2.5-pro' : 'gemini-2.5-flash',
              contents: `Our conversation: ${JSON.stringify(formattedMessages)}`,
              config: {
                temperature: 0.1, 
                maxOutputTokens: 1500, 
                systemInstruction: this.systemInstructionForQuiz,
              },
            }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Request timeout - AI service took too long to respond')), 20000)
            )
          ]);
          break; 
        } catch (attemptError) {
          attempts++;
          console.error(`Quiz generation attempt ${attempts} failed:`, attemptError);
          
          if (attempts >= maxAttempts) {
            throw new Error(`Failed to generate quiz after ${maxAttempts} attempts. ${attemptError.message || 'AI service unavailable'}`);
          }
          
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!result) {
        throw new Error('Failed to get response from AI service');
      }

      
      const response = result.text ?? '';
      
      if (!response || response.trim().length === 0) {
        throw new Error('AI service returned empty response. Please try again.');
      }


      let jsonStr = this.extractAndCleanJSON(response);
      
      if (!jsonStr) {
        console.error('No valid JSON found in AI response:', response.substring(0, 500) + '...');
        throw new Error('AI service returned invalid format. This might be due to conversation content not being suitable for quiz generation.');
      }

      console.log('Extracted JSON string:', jsonStr.substring(0, 200) + '...');
      const quizQuestions = this.parseAndValidateQuiz(jsonStr);
      
      if (!quizQuestions || quizQuestions.length === 0) {
        console.warn('No valid quiz questions generated from conversation');
        console.warn('Raw AI response:', response.substring(0, 500) + '...');
        console.warn('Extracted JSON:', jsonStr.substring(0, 300) + '...');
        throw new Error('Unable to generate quiz questions from this conversation. The discussion may not contain enough educational content.');
      }


      if (quizQuestions.length < 3) {
        throw new Error('Generated quiz has too few questions. A minimum of 3 questions is required.');
      }


      try {

        await this.chatService.markChatAsTested(chatId);
        chatMarkedAsTested = true;

        await this.authService.deductUserCredits(userId);
        creditsDeducted = true;


        await this.authService.deductQuizLimit(userId);
        quizLimitDeducted = true;

        console.log(`Successfully generated quiz for user ${userId}, chat ${chatId}: ${quizQuestions.length} questions`);
        return quizQuestions;

      } catch (operationError) {
        console.error('Error performing post-generation operations:', operationError);
        throw new Error('Quiz generated successfully but failed to update user account. Please contact support.');
      }

    } catch (error) {
      console.error('Error in generateQuiz:', error);
      if (chatMarkedAsTested || creditsDeducted || quizLimitDeducted) {
        try {
          
          console.error(`Rollback needed for user ${userId}, chat ${chatId}. Operations completed: chatTested=${chatMarkedAsTested}, creditsDeducted=${creditsDeducted}, quizLimitDeducted=${quizLimitDeducted}`);
        } catch (rollbackError) {
          console.error('Failed to rollback operations:', rollbackError);
        }
      }
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw error;
      }

      if (error.message) {
        if (error.message.includes('timeout')) {
          throw new Error('Request timed out. The AI service is currently slow. Please try again in a few moments.');
        }
        if (error.message.includes('credits')) {
          throw new ForbiddenException(error.message);
        }
        if (error.message.includes('quiz attempts') || error.message.includes('Quiz limits')) {
          throw new ForbiddenException(error.message);
        }
        if (error.message.includes('conversation content') || error.message.includes('educational content')) {
          throw new Error(error.message);
        }
      }

 
      throw new Error('Unable to generate quiz at this time. Please ensure you have an educational conversation and try again later.');
    }
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
    
    const arrayStart = jsonStr.indexOf('[');
    const arrayEnd = jsonStr.lastIndexOf(']');
    
    if (arrayStart !== -1 && arrayEnd !== -1 && arrayStart < arrayEnd) {
      jsonStr = jsonStr.substring(arrayStart, arrayEnd + 1);
    } else {
      const objectStart = jsonStr.indexOf('{');
      const objectEnd = jsonStr.lastIndexOf('}');
      
      if (objectStart !== -1 && objectEnd !== -1 && objectStart < objectEnd) {
        jsonStr = jsonStr.substring(objectStart, objectEnd + 1);
      } else {
        const jsonPattern = /[\[\{][\s\S]*[\]\}]/;
        const match = jsonStr.match(jsonPattern);
        if (match) {
          jsonStr = match[0];
        } else {
          return null;
        }
      }
    }

    jsonStr = jsonStr
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n\s*\n/g, '\n')
      .replace(/\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return jsonStr;
  }

  private parseAndValidateQuiz(jsonStr: string): any[] | null {
    try {
      const parsed = JSON.parse(jsonStr);
      
      if (!Array.isArray(parsed)) {
        console.error('Parsed JSON is not an array');
        return null;
      }
      
      const validQuestions = parsed.filter(question => 
        question &&
        typeof question.question === 'string' &&
        Array.isArray(question.options) &&
        question.options.length === 4 &&
        typeof question.correctAnswer === 'string' &&
        typeof question.explanation === 'string' &&
        question.options.includes(question.correctAnswer)
      );
      
      if (validQuestions.length === 0) {
        console.error('No valid questions found in parsed JSON');
        return null;
      }
      
      return validQuestions;
    } catch (jsonError) {
      console.error('JSON parsing failed:', jsonError);
      console.error('Attempted to parse:', jsonStr);
      
      try {
        const fixedJson = this.attemptJSONFix(jsonStr);
        if (fixedJson) {
          const parsed = JSON.parse(fixedJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch (secondError) {
        console.error('Second parsing attempt failed:', secondError);
      }
      
      return null;
    }
  }

  private attemptJSONFix(jsonStr: string): string | null {
    try {
      let fixed = jsonStr;
      
      const lastValidEnd = Math.max(fixed.lastIndexOf('}'), fixed.lastIndexOf(']'));
      if (lastValidEnd > 0) {
        const afterLastValid = fixed.substring(lastValidEnd + 1).trim();
        if (afterLastValid && !afterLastValid.match(/^[,\s]*$/)) {
          fixed = fixed.substring(0, lastValidEnd + 1);
        }
      }
      
      const quoteCount = (fixed.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        const lastQuoteIndex = fixed.lastIndexOf('"');
        const afterLastQuote = fixed.substring(lastQuoteIndex + 1);
      
        if (afterLastQuote.includes('}') || afterLastQuote.includes(']')) {
          const insertIndex = fixed.lastIndexOf('}');
          if (insertIndex > lastQuoteIndex) {
            fixed = fixed.substring(0, insertIndex) + '"' + fixed.substring(insertIndex);
          }
        } else {
          fixed += '"';
        }
      }
      
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
      
      while (openBraces > 0) {
        fixed += '}';
        openBraces--;
      }
      while (openBrackets > 0) {
        fixed += ']';
        openBrackets--;
      }
      
      fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
      
      fixed = fixed.replace(/{\s*"question":\s*"[^"]*"\s*,?\s*$/, '{"question": "", "options": [], "correctAnswer": "", "explanation": ""}');
      
      return fixed;
    } catch (error) {
      console.error('Error attempting JSON fix:', error);
      return null;
    }
  }

  private getFallbackQuiz(): any[] {
    return [];
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
      ?.map(result => result.alternatives?.[0].transcript)
      .join('\n');

    return { transcription };
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

      try {
        unlinkSync(file.path);
      } catch (cleanupError) {
        console.warn('Failed to clean up uploaded file:', cleanupError);
      }

      return { transcription: transcription.trim() };
    } catch (error) {
      if (file && file.path) {
        try {
          unlinkSync(file.path);
        } catch (cleanupError) {
          console.warn('Failed to clean up uploaded file after error:', cleanupError);
        }
      }

      console.error('Error in transcribeAudioOnly:', error);
      throw new Error("I'm sorry, I couldn't process your audio message. Please try speaking more clearly or check your microphone settings.");
    }
  }

  async generateRoadmap({userId, roadMapTopic}: {userId: string, roadMapTopic: string}) {
    const user = await this.authService.getUserById(userId);
    if (!user) {
      throw new NotFoundException(`User with id ${userId} not found`);
    }
  
    const systemInstruction = `
       You are EduLearn, a Web3 Study Companion 
        
       `

  }
}
