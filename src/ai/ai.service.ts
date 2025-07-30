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
You are EduLearn, an AI tutor for Web3-native learners with a focus on the Solana ecosystem.

Your job is to guide users to understanding, not just give answers. Use strategic hints, analogies, and questions to lead them to solutions. Keep your tone friendly, engaging, and supportive — use emojis to keep things lively 😊.

Focus Areas:
- Solana architecture (accounts, programs, rent)
- Rust + Anchor smart contract development
- Solana CLI, keypairs, wallets (Phantom, Backpack)
- PDAs, CPIs, SPL tokens, Metaplex
- Solana/web3.js, React-based dApp development
- Transactions, fee optimization, on/off-chain logic

Teaching Style:
- Encourage active learning and problem-solving
- Use metaphors (e.g., PDA = derived mailbox 📬)
- Ask thoughtful, guiding questions 💭
- Gently redirect off-topic questions toward Solana or Web3 topics
- Make learning practical, fun, and hands-on 🚀
`;

  private readonly systemInstructionForQuiz = `Based on the context of our conversation so far, generate as many quiz questions as appropriate to test my understanding — but only if the discussion included educational or learning-based content (e.g., coding, math, science, problem-solving, academic concepts). If the conversation was casual or unrelated to learning, return an empty array.

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
  constructor(
    private configService: ConfigService,
    private chatService: ChatService,
    private authService: AuthService,
    private activityService: ActivityService
  ) {
    const aiApiKey = process.env.GEMINI_API_KEY;
    if (!aiApiKey) {
      throw new Error('AI API Key is not configured');
    }
    this.genAI = new GoogleGenAI({
      apiKey: aiApiKey,
    });
  }

  async generateTitleFromMessage(message: Message): Promise<string> {
    try {
      const formattedMessage = {
        role: 'user',
        text: message.content,
      };
      const result = await this.genAI.models.generateContent({
        model: 'gemini-1.5-flash',
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
      });

      const titleResponse = result.text?.trim();
      return titleResponse || 'Untitled Chat';
    } catch (error) {
      console.error('Error generating title:', error);
      return 'Untitled Chat';
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
      chat = await this.chatService.createChat({ title, userId });
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

    const formattedMessages = messages.map((msg: any) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text:
            typeof msg.content === 'string' ? msg.content : msg.content.text,
        },
      ],
    }));

    const result = await this.genAI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: formattedMessages,
      config: {
        tools: [{ functionDeclarations: [this.scoreUser] }],
        maxOutputTokens: 3000,
        temperature: 1,
        systemInstruction: this.systemInstruction,
      },
    });

    await this.authService.deductUserCredits(userId);

    const candidate = result.candidates?.[0];
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
        await this.authService.updateUserXP(userId, score, 'chat');
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

    console.log(assistantMessage);
    return assistantMessage;
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
