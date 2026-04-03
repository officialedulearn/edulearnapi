import { Injectable, Logger } from '@nestjs/common';
import { nftRewards } from './config/nft-rewards';

@Injectable()
export class NftRewardService {
  private readonly logger = new Logger(NftRewardService.name);

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
}
