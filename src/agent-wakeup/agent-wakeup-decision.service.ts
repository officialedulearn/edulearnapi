import { Type } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { GeminiClientService } from 'src/ai/gemini-client.service';
import type { AgentWakeupDecision } from './agent-wakeup.types';

const WAKEUP_DECISION_MAX_ATTEMPTS = 2;

@Injectable()
export class AgentWakeupDecisionService {
  private readonly logger = new Logger(AgentWakeupDecisionService.name);

  constructor(private readonly geminiClient: GeminiClientService) {}

  private parseDecisionJson(raw: string): AgentWakeupDecision {
    const parsed = JSON.parse(raw) as AgentWakeupDecision;
    const chatTitle = String(parsed.chatTitle || '').trim();
    const messageText = String(parsed.messageText || '').trim();
    const why = String(parsed.why || '').trim();

    if (!chatTitle) {
      throw new Error('AgentWakeupDecisionService: chatTitle is required');
    }
    if (!messageText) {
      throw new Error('AgentWakeupDecisionService: messageText is required');
    }

    return {
      chatTitle: chatTitle.slice(0, 80),
      messageText: messageText.slice(0, 800),
      why: why || undefined,
    };
  }

  async decide(params: {
    agentName: string;
    agentPurpose: string;
    userName: string;
    userLevel: string;
    userLearning: string;
    userMemory: string;
    recentActivities: string[];
    recentRoadmaps: Array<{
      topic: string;
      title: string;
      description: string;
    }>;
    lastQuizSummary?: string;
    missedQuestions: Array<{ question: string; explanation: string }>;
  }): Promise<{ decision: AgentWakeupDecision; modelMeta: any }> {
    const agentName = params.agentName.trim() || 'Eddy';
    const agentPurpose =
      params.agentPurpose.trim() || 'Help the user keep improving every week.';
    const userName = params.userName.trim() || 'Learner';
    const userLevel = params.userLevel.trim() || 'novice';
    const userLearning = params.userLearning.trim() || 'general learning';
    const userMemory = params.userMemory.trim() || '(none)';
    const lastQuizSummary =
      params.lastQuizSummary?.trim() || 'No submitted quiz attempts yet.';
    const activities = params.recentActivities.length
      ? params.recentActivities.join('\n- ')
      : '(none)';
    const roadmaps = params.recentRoadmaps.length
      ? params.recentRoadmaps
          .map((r, i) => {
            const topic = String(r.topic || '').trim();
            const title = String(r.title || '').trim();
            const description = String(r.description || '')
              .trim()
              .slice(0, 180);
            return `${i + 1}. ${title || topic || 'Roadmap'} (${topic || 'n/a'}) - ${description || 'no description'}`;
          })
          .join('\n')
      : '(none)';
    const misses = params.missedQuestions.length
      ? params.missedQuestions
          .map(
            (m, i) =>
              `${i + 1}. Q: ${m.question.trim().slice(0, 160)} | Expl: ${m.explanation.trim().slice(0, 160)}`,
          )
          .join('\n')
      : '(none)';

    const systemInstruction = `
You are ${agentName}, the user's personal learning agent in EduLearn.
Your tone is concise, warm, and practical.

Goal:
- Produce a short proactive coaching message that helps the user improve now.
- If there are missed quiz questions, focus on the biggest confusion points.
- If there is no quiz attempt yet, teach one short practical tip from agent purpose and user memory.

User context:
- Name: ${userName}
- Level: ${userLevel}
- Current learning focus: ${userLearning}
- Agent purpose: ${agentPurpose}
- User memory: ${userMemory}
- Last quiz summary: ${lastQuizSummary}
- Missed quiz items:
${misses}
- Recent activities:
- ${activities}
- Top 2 recent roadmaps:
${roadmaps}

Output rules:
- chatTitle: <= 8 words, plain text.
- messageText: 2-5 short paragraphs, no markdown lists, no hashtags.
- Include one very specific next action.
- Avoid spammy language.
- Return ONLY valid JSON.
`;

    let lastError: Error | null = null;
    let lastUsage: unknown;

    for (let attempt = 1; attempt <= WAKEUP_DECISION_MAX_ATTEMPTS; attempt++) {
      let rawForLog = '';
      try {
        const result = await this.geminiClient.genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents:
            'Generate a short proactive coaching wake-up message for this user.',
          config: {
            maxOutputTokens: 1600,
            temperature: 0.6,
            thinkingConfig: { thinkingBudget: 0 },
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                chatTitle: { type: Type.STRING },
                messageText: { type: Type.STRING },
                why: { type: Type.STRING },
              },
              required: ['chatTitle', 'messageText'],
            },
          },
        });

        lastUsage = (result as { usageMetadata?: unknown }).usageMetadata;
        const raw = result.text?.trim();
        rawForLog = raw ?? '';
        if (!raw) {
          throw new Error('AgentWakeupDecisionService: empty AI response');
        }

        const finishReason = (
          result as { candidates?: { finishReason?: string }[] }
        ).candidates?.[0]?.finishReason;
        if (finishReason === 'MAX_TOKENS') {
          throw new Error(
            'AgentWakeupDecisionService: response truncated (MAX_TOKENS)',
          );
        }

        const parsed = this.parseDecisionJson(raw);
        const modelMeta = {
          model: 'gemini-2.5-flash',
          usage: lastUsage,
          attempt,
        };
        return { decision: parsed, modelMeta };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (rawForLog) {
          this.logger.warn(
            `AgentWakeupDecisionService raw (attempt ${attempt}): ${rawForLog.slice(0, 500)}`,
          );
        }
        this.logger.warn(
          `AgentWakeupDecisionService attempt ${attempt}/${WAKEUP_DECISION_MAX_ATTEMPTS} failed: ${lastError.message}`,
        );
        if (attempt < WAKEUP_DECISION_MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    throw lastError ?? new Error('AgentWakeupDecisionService: decision failed');
  }
}
