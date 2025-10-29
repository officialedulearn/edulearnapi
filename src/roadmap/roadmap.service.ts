import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { AuthService } from 'src/auth/auth.service';
import { roadmap, roadMapStep, chat } from 'lib/db/schema';
import db from '../../drizzle';
import { GoogleGenAI } from '@google/genai';
import { eq, and } from 'drizzle-orm';
import { ChatService } from 'src/chat/chat.service';
import { generateUUID } from 'lib/utils';
import { AiService } from 'src/ai/ai.service';
import { RewardsService } from 'src/rewards/rewards.service';

@Injectable()
export class RoadmapService {
    private readonly genAI: GoogleGenAI;
    constructor(
        @Inject(forwardRef(() => AuthService))
        private readonly authService: AuthService,
        private readonly chatService: ChatService,
        @Inject(forwardRef(() => AiService))
        private readonly aiService: AiService,
        private readonly rewardsService: RewardsService,
    ) {
        this.genAI = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
        });
    }

    async createRoadmap(userId: string, chatId: string, topic: string, title: string, description: string, claimableNFT?: string | null) {
        const roadmapData: any = { userId, chatId, topic, title, description };
        
        if (claimableNFT) {
            roadmapData.claimableNFT = claimableNFT;
        }
        
        const newRoadmap = await db.insert(roadmap).values(roadmapData).returning();
        return newRoadmap[0];
    }

    async createRoadmapStep(roadmapId: string, prompt: string, title: string, description: string, time: number) {
        const newRoadmapStep = await db.insert(roadMapStep).values({ roadmapId, prompt, title, description, time }).returning();
        return newRoadmapStep[0];
    }
    
    async generateRoadmap(userId: string, topic: string) {
        const user = await this.authService.getUserById(userId);
        if (!user) {
            throw new NotFoundException(`User with id ${userId} not found`);
        }

        const chat = await this.chatService.createChat({ 
            title: `Roadmap: ${topic}`, 
            userId 
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
                model: user.isPremium ? "gemini-2.5-pro" : "gemini-2.5-flash",
                contents: [{ role: 'user', parts: [{ text: `Generate a learning roadmap for: ${topic}` }] }],
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

            let jsonStr = this.extractAndCleanJSON(responseText);
            if (!jsonStr) {
                console.error('No valid JSON found in AI response:', responseText);
                throw new Error('AI service returned invalid format');
            }

            console.log('Extracted JSON string (first 500 chars):', jsonStr.substring(0, 500));

            let roadmapData;
            try {
                roadmapData = JSON.parse(jsonStr);
            } catch (parseError) {
                console.error('JSON parsing failed:', parseError);
                console.error('Failed JSON (first 1000 chars):', jsonStr.substring(0, 1000));
                
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
                    throw new Error(`Failed to parse roadmap JSON: ${parseError.message}`);
                }
            }

            if (!roadmapData.title || !roadmapData.description || !Array.isArray(roadmapData.steps)) {
                console.error('Invalid roadmap structure:', roadmapData);
                throw new Error('Invalid roadmap structure - missing required fields');
            }

            if (roadmapData.steps.length === 0) {
                throw new Error('Roadmap must have at least one step');
            }
            const claimableNFT = this.aiService.analyzeTopicForNFT(topic);
            
            const newRoadmap = await this.createRoadmap(
                userId, 
                chat.id, 
                topic, 
                roadmapData.title, 
                roadmapData.description,
                claimableNFT
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
                        Number(step.time) || 5
                    );
                })
            );

            const validSteps = createdSteps.filter(step => step !== null);

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
        const result = await db.select().from(roadmap).where(eq(roadmap.id, roadmapId));
        return result.length ? result[0] : null;
    }

    async getRoadmapsByUserId(userId: string) {
        return await db.select().from(roadmap).where(eq(roadmap.userId, userId));
    }

    async getRoadmapSteps(roadmapId: string) {
        return await db.select().from(roadMapStep).where(eq(roadMapStep.roadmapId, roadmapId));
    }

    async checkAndAwardRoadmapNFT(roadmapId: string, userId: string): Promise<boolean> {
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

            const allStepsDone = steps.every(step => step.done === true);
            if (!allStepsDone) {
                const completedCount = steps.filter(step => step.done === true).length;
                console.log(`Roadmap ${roadmapId} steps: ${completedCount}/${steps.length} completed`);
                return false;
            }

            const chatData = await this.chatService.getChatById(roadmapData.chatId);
            if (!chatData) {
                console.log(`Chat ${roadmapData.chatId} not found for roadmap ${roadmapId}`);
                return false;
            }

            const hasTestedKnowledge = (chatData.testLimit || 3) < 3;
            if (!hasTestedKnowledge) {
                console.log(`Chat ${roadmapData.chatId} has not been tested yet. User must complete at least one quiz to verify their knowledge.`);
                return false;
            }

            const userRewards = await this.rewardsService.getUserRewards(userId);
            const alreadyHasNFT = userRewards.some(reward => reward.id === roadmapData.claimableNFT);
            
            if (alreadyHasNFT) {
                console.log(`User ${userId} already has NFT ${roadmapData.claimableNFT}`);
                return false;
            }

            console.log(`🎉 Awarding NFT ${roadmapData.claimableNFT} to user ${userId} for completing roadmap ${roadmapId}`);
            
            await this.rewardsService.awardRewardToUser(userId, roadmapData.claimableNFT);
            
            console.log(`✅ Successfully awarded NFT ${roadmapData.claimableNFT} to user ${userId}`);
            return true;

        } catch (error) {
            console.error(`Error checking/awarding roadmap NFT for roadmap ${roadmapId}:`, error);
            return false;
        }
    }

    async startRoadmapStep(stepId: string, userId: string, aiService: any) {
        const steps = await db.select().from(roadMapStep).where(eq(roadMapStep.id, stepId));
        if (!steps.length) {
            throw new NotFoundException('Roadmap step not found');
        }
        const step = steps[0];

        const roadmapData = await this.getRoadmapById(step.roadmapId);
        if (!roadmapData) {
            throw new NotFoundException('Roadmap not found');
        }

        if (roadmapData.userId !== userId) {
            throw new NotFoundException('You do not have permission to access this roadmap');
        }

        const currentMessages = await this.chatService.getMessagesInChat(roadmapData.chatId);

        const userMessage = {
            id: generateUUID(),
            role: 'user',
            content: { text: step.prompt },
            createdAt: new Date(),
            chatId: roadmapData.chatId,
        };

        const messagesWithNewPrompt = [...currentMessages, userMessage];

        const aiResponse = await aiService.generateResponse({
            messages: messagesWithNewPrompt,
            chatId: roadmapData.chatId,
            userId,
        });

        await db.update(roadMapStep).set({ done: true }).where(eq(roadMapStep.id, stepId));

        const nftAwarded = await this.checkAndAwardRoadmapNFT(step.roadmapId, userId);
        if (nftAwarded && roadmapData.claimableNFT) {
            const nftInfo = this.aiService.getNFTRewardInfoById(roadmapData.claimableNFT);

            if (nftInfo) {
                const congratsMessage = `\n\n🎉🎉🎉 **CONGRATULATIONS!** 🎉🎉🎉\n\n` +
                    `You've completed the entire "${roadmapData.title}" roadmap! 🗺️✨\n\n` +
                    `As a reward for your dedication and hard work, you've earned the **${nftInfo.name}** NFT certificate! 🏆\n\n` +
                    `${nftInfo.description}\n\n` +
                    `💎 You can view and claim your NFT in the rewards section. Keep up the amazing learning journey! 🚀`;

                if (aiResponse.content && typeof aiResponse.content === 'object' && 'text' in aiResponse.content) {
                    aiResponse.content.text = `${aiResponse.content.text}\n\n${congratsMessage}`;
                }

                await this.chatService.saveMessages({ messages: [aiResponse] });
            }
        }

        return {
            step,
            userMessage,
            aiResponse,
            nftAwarded,
        };
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
                if (nextComma !== -1) insertPos = Math.min(insertPos, lastQuotePos + 1 + nextComma);
                if (nextBrace !== -1) insertPos = Math.min(insertPos, lastQuotePos + 1 + nextBrace);
                if (nextBracket !== -1) insertPos = Math.min(insertPos, lastQuotePos + 1 + nextBracket);
                
                fixed = fixed.substring(0, insertPos) + '"' + fixed.substring(insertPos);
            }
            
            return fixed;
        } catch (error) {
            console.error('Error attempting JSON fix:', error);
            return null;
        }
    }       
}
