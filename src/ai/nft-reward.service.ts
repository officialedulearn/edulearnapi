import { Type } from '@google/genai';
import { Injectable, Logger } from '@nestjs/common';
import { nftRewards } from './config/nft-rewards';
import { GeminiClientService } from './gemini-client.service';

const EXCLUDED_FROM_AI_NFT_SELECTION = new Set(['milestone500XP']);

@Injectable()
export class NftRewardService {
  private readonly logger = new Logger(NftRewardService.name);

  constructor(private readonly geminiClient: GeminiClientService) {}

  getNFTRewardInfo(certificateType: string) {
    if (certificateType in nftRewards) {
      return nftRewards[certificateType as keyof typeof nftRewards];
    }
    return null;
  }

  getNFTRewardInfoById(rewardId: string) {
    for (const [key, nftReward] of Object.entries(nftRewards)) {
      if (nftReward.id === rewardId) {
        return { key, ...nftReward };
      }
    }
    return null;
  }

  getAllNFTRewards() {
    return Object.entries(nftRewards).map(([key, value]) => ({
      key,
      ...value,
    }));
  }

  private topicMatchesRequirement(
    normalizedTopic: string,
    reqTopic: string,
  ): boolean {
    const r = reqTopic.toLowerCase().trim();
    if (!r) {
      return false;
    }
    if (normalizedTopic.includes(r)) {
      return true;
    }
    const tokens = r.split(/\s+/).filter((t) => t.length >= 3);
    if (tokens.length >= 2) {
      return tokens.every((t) => normalizedTopic.includes(t));
    }
    return false;
  }

  analyzeTopicForNFT(topic: string): string | null {
    if (!topic || typeof topic !== 'string') {
      return null;
    }

    const normalizedTopic = topic.toLowerCase().trim();

    type Candidate = {
      key: string;
      id: string;
      name: string;
      matchCount: number;
      sumMatchedLen: number;
      maxMatchedLen: number;
    };

    const candidates: Candidate[] = [];

    for (const [key, nftReward] of Object.entries(nftRewards)) {
      const requiredTopics = nftReward.requiredTopics || [];
      let matchCount = 0;
      let sumMatchedLen = 0;
      let maxMatchedLen = 0;

      for (const reqTopic of requiredTopics) {
        if (this.topicMatchesRequirement(normalizedTopic, reqTopic)) {
          matchCount += 1;
          const len = reqTopic.length;
          sumMatchedLen += len;
          maxMatchedLen = Math.max(maxMatchedLen, len);
        }
      }

      const qualifies =
        matchCount >= 2 || maxMatchedLen >= 8 || sumMatchedLen >= 10;

      if (qualifies) {
        candidates.push({
          key,
          id: nftReward.id,
          name: nftReward.name,
          matchCount,
          sumMatchedLen,
          maxMatchedLen,
        });
      }
    }

    if (candidates.length === 0) {
      this.logger.debug(`No NFT match found for topic: "${topic}"`);
      return null;
    }

    candidates.sort(
      (a, b) =>
        b.matchCount - a.matchCount ||
        b.sumMatchedLen - a.sumMatchedLen ||
        b.maxMatchedLen - a.maxMatchedLen,
    );

    const best = candidates[0];
    this.logger.debug(
      `NFT match: ${best.key} (${best.name}) for topic "${topic}" — ${best.matchCount} hits, score ${best.sumMatchedLen}`,
    );
    return best.id;
  }

  private buildNftCatalogForPrompt(): string {
    return Object.entries(nftRewards)
      .filter(([key]) => !EXCLUDED_FROM_AI_NFT_SELECTION.has(key))
      .map(([key, value]) => {
        const crit =
          value.criteria.length > 320
            ? `${value.criteria.slice(0, 317)}...`
            : value.criteria;
        return `${key}: ${value.name} — ${crit}`;
      })
      .join('\n');
  }

  private getSelectableNftKeys(): string[] {
    return Object.keys(nftRewards).filter(
      (key) => !EXCLUDED_FROM_AI_NFT_SELECTION.has(key),
    );
  }

  private extractJsonObjectFromText(text: string): string | null {
    let s = text.trim();
    if (s.includes('```json')) {
      const m = s.match(/```json\s*([\s\S]*?)\s*```/);
      if (m?.[1]) {
        s = m[1].trim();
      }
    } else if (s.includes('```')) {
      const m = s.match(/```\s*([\s\S]*?)\s*```/);
      if (m?.[1]) {
        s = m[1].trim();
      }
    }
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || start >= end) {
      return null;
    }
    return s.slice(start, end + 1);
  }

  private normalizeJsonishQuotes(s: string): string {
    return s
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
  }

  private stripDisallowedControlChars(s: string): string {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (
        c === 9 ||
        c === 10 ||
        c === 13 ||
        (c >= 32 && c !== 127 && (c < 128 || c > 159))
      ) {
        out += s[i];
      }
    }
    return out;
  }

  private parseNftSelectionPayload(raw: string): { rewardKey?: string } | null {
    const trimmed = this.normalizeJsonishQuotes(raw.trim());
    if (!trimmed) {
      return null;
    }

    const attempts: string[] = [trimmed];
    const extracted = this.extractJsonObjectFromText(trimmed);
    if (extracted) {
      attempts.push(extracted);
    }

    for (const candidate of attempts) {
      const sanitized = this.stripDisallowedControlChars(candidate);
      try {
        const parsed = JSON.parse(sanitized) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0) {
          const first: unknown = parsed[0];
          if (
            first !== null &&
            typeof first === 'object' &&
            'rewardKey' in first
          ) {
            const rk = (first as Record<string, unknown>).rewardKey;
            if (typeof rk === 'string') {
              return { rewardKey: rk };
            }
          }
        }
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          'rewardKey' in parsed
        ) {
          const rk = (parsed as Record<string, unknown>).rewardKey;
          if (typeof rk === 'string') {
            return { rewardKey: rk };
          }
        }
      } catch {
        // try next
      }
    }

    const keyMatch = /"rewardKey"\s*:\s*"([^"]+)"/.exec(trimmed);
    if (keyMatch?.[1]) {
      return { rewardKey: keyMatch[1] };
    }

    return null;
  }

  async selectNftForRoadmapWithGemini(
    model: string,
    params: {
      topic: string;
      roadmapTitle: string;
      roadmapDescription: string;
      userIntent?: string | null;
    },
  ): Promise<string | null> {
    const selectableKeys = this.getSelectableNftKeys();
    const catalog = this.buildNftCatalogForPrompt();

    const systemInstruction = `You assign ONE EduLearn achievement badge to a learning roadmap. The learner can claim this badge after completing the roadmap and taking a quiz.

Rules:
- Pick exactly one key from the catalog below that best matches the roadmap topic, title, description, and (if given) learner intent.
- Map related ideas (e.g. Solana / program development → smartContractBasics when it is about on-chain programs; EVM vs Solana still use the closest badge).
- If nothing fits well, return rewardKey "NONE".
- rewardKey must be exactly one of the keys listed before the colon in the catalog, or NONE.

Catalog (keys are before each colon):
${catalog}`;

    const userPayload = [
      `Topic: ${params.topic}`,
      `Roadmap title: ${params.roadmapTitle}`,
      `Roadmap description: ${params.roadmapDescription}`,
      params.userIntent?.trim()
        ? `Learner intent: ${params.userIntent.trim()}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const result = await this.geminiClient.genAI.models.generateContent({
        model,
        contents: userPayload,
        config: {
          temperature: 0.2,
          maxOutputTokens: 256,
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rewardKey: {
                type: Type.STRING,
                description: `One of: ${selectableKeys.join(', ')}, or NONE`,
              },
            },
            required: ['rewardKey'],
          },
        },
      });

      const responseText = result.text?.trim();
      if (!responseText) {
        this.logger.warn('Gemini returned empty NFT selection');
        return null;
      }

      const parsed = this.parseNftSelectionPayload(responseText);
      if (!parsed) {
        this.logger.warn(
          `Failed to parse NFT selection JSON (first 200 chars): ${responseText.slice(0, 200)}`,
        );
        return null;
      }

      const raw = parsed.rewardKey?.trim();
      if (!raw || raw === 'NONE') {
        this.logger.debug(
          `Gemini NFT selection: none for topic "${params.topic}"`,
        );
        return null;
      }

      if (!(raw in nftRewards) || EXCLUDED_FROM_AI_NFT_SELECTION.has(raw)) {
        this.logger.warn(`Invalid Gemini NFT rewardKey: ${raw}`);
        return null;
      }

      const id = nftRewards[raw as keyof typeof nftRewards].id;
      this.logger.debug(
        `Gemini NFT selection: ${raw} for topic "${params.topic}"`,
      );
      return id;
    } catch (error) {
      this.logger.warn(
        `Gemini NFT selection failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
