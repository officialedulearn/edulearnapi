import { Injectable } from '@nestjs/common';
import { nftRewards } from './config/nft-rewards';

@Injectable()
export class NftRewardService {
  getNFTRewardInfo(certificateType: string) {
    return nftRewards[certificateType] || null;
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

  analyzeTopicForNFT(topic: string): string | null {
    if (!topic || typeof topic !== 'string') {
      return null;
    }

    const normalizedTopic = topic.toLowerCase().trim();

    for (const [key, nftReward] of Object.entries(nftRewards)) {
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
}
