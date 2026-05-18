import { Type } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { GeminiClientService } from 'src/ai/gemini-client.service';
import {
  REMINDER_MAX_NEXT_CHECK_DAYS,
  REMINDER_MIN_NEXT_CHECK_DAYS,
} from './reminders.constants';
import type { ReminderAiDecision } from './reminders.types';

const REMINDER_DECISION_MAX_ATTEMPTS = 2;

@Injectable()
export class ReminderDecisionService {
  private readonly logger = new Logger(ReminderDecisionService.name);
  constructor(private readonly geminiClient: GeminiClientService) {}

  private parseDecisionJson(raw: string): ReminderAiDecision {
    const parsed = JSON.parse(raw) as ReminderAiDecision;
    const next = Number(parsed.nextCheckInDays);
    parsed.nextCheckInDays = Number.isFinite(next)
      ? Math.max(
          REMINDER_MIN_NEXT_CHECK_DAYS,
          Math.min(REMINDER_MAX_NEXT_CHECK_DAYS, Math.floor(next)),
        )
      : 7;

    if (!parsed.send) {
      delete parsed.subject;
      delete parsed.tip;
      delete parsed.personalizedRecap;
    }

    return parsed;
  }

  async decide(params: {
    goalText: string;
    userName: string;
    userLevel?: string | null;
    recentQuizSummary: string;
    hasQuizHistory: boolean;
    agentName?: string | null;
    agentPurpose?: string | null;
  }): Promise<{ decision: ReminderAiDecision; modelMeta: any }> {
    const goal = (params.goalText || '').trim() || 'general learning';
    const userName = params.userName?.trim() || 'Learner';
    const userLevel = params.userLevel?.trim() || 'novice';
    const recentQuizSummary =
      params.recentQuizSummary?.trim() || 'No recent quiz attempts yet.';
    const agentName = (params.agentName || '').trim() || 'Eddy';
    const agentPurpose = (params.agentPurpose || '').trim();

    const systemInstruction = `
You are ${agentName}, the user's personal learning agent inside EduLearn.

Your job is to decide whether to send a reminder email right now, and when to check again.
Keep reminders rare; only send when you believe it will be genuinely helpful.

User context:
- Name: ${userName}
- Level: ${userLevel}
- Agent purpose: ${agentPurpose || '(not provided)'}
- Goal: ${goal}
- Recent quiz performance: ${recentQuizSummary}

Rules:
- If there is no quiz history, prefer NOT sending unless a gentle first nudge is clearly beneficial.
- Tips must be short (1-2 sentences), actionable, and connected to the user's goal.
- Subject must be non-spammy, <= 60 characters, no ALL CAPS, no excessive punctuation.
- Choose nextCheckInDays between ${REMINDER_MIN_NEXT_CHECK_DAYS} and ${REMINDER_MAX_NEXT_CHECK_DAYS}.

Return ONLY valid JSON (no markdown).
`;

    let lastError: Error | null = null;
    let lastUsage: unknown;

    for (let attempt = 1; attempt <= REMINDER_DECISION_MAX_ATTEMPTS; attempt++) {
      let rawForLog = '';
      try {
        const result = await this.geminiClient.genAI.models.generateContent({
          model: 'gemini-2.5-flash',
          contents:
            'Decide whether to send a personalized reminder email now, and what to include.',
          config: {
            maxOutputTokens: 2048,
            temperature: 0.4,
            thinkingConfig: { thinkingBudget: 0 },
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                send: { type: Type.BOOLEAN },
                subject: { type: Type.STRING },
                tip: { type: Type.STRING },
                personalizedRecap: { type: Type.STRING },
                nextCheckInDays: { type: Type.INTEGER },
                why: { type: Type.STRING },
              },
              required: ['send', 'nextCheckInDays'],
            },
          },
        });

        lastUsage = (result as { usageMetadata?: unknown }).usageMetadata;
        const raw = result.text?.trim();
        rawForLog = raw ?? '';
        if (!raw) {
          throw new Error('ReminderDecisionService: empty AI response');
        }

        const finishReason = (result as { candidates?: { finishReason?: string }[] })
          .candidates?.[0]?.finishReason;
        if (finishReason === 'MAX_TOKENS') {
          throw new Error(
            `ReminderDecisionService: response truncated (finishReason=MAX_TOKENS)`,
          );
        }

        const parsed = this.parseDecisionJson(raw);
        const modelMeta = {
          model: 'gemini-2.5-flash',
          usage: lastUsage,
          attempt,
        };
        this.logger.log(`ReminderDecisionService: ${JSON.stringify(parsed)}`);
        return { decision: parsed, modelMeta };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (rawForLog) {
          this.logger.warn(
            `ReminderDecisionService raw (attempt ${attempt}): ${rawForLog.slice(0, 500)}`,
          );
        }
        this.logger.warn(
          `ReminderDecisionService attempt ${attempt}/${REMINDER_DECISION_MAX_ATTEMPTS} failed: ${lastError.message}`,
        );
        if (attempt < REMINDER_DECISION_MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    }

    throw lastError ?? new Error('ReminderDecisionService: decision failed');
  }
}
