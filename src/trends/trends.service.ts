import { Injectable } from '@nestjs/common';
import Perplexity from '@perplexity-ai/perplexity_ai';
import { trends, Trends } from '../../lib/db/schema';
import db from 'drizzle';

@Injectable()
export class TrendsService {
  private readonly perplexityClient = new Perplexity({
    apiKey: process.env.PERPLEXITY_API_KEY,
  });

  async fetchWeeklyTrendsFromPerplexity(): Promise<Trends[]> {
    const response = await this.perplexityClient.chat.completions.create({
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content: `
            Return ONLY valid JSON.
            
            Format:
            {
              "results": [
                {
                  "title": "string",
                  "description": "string",
                  "tags": ["string"],
                }
              ]
            }
                  `,
        },
        {
          role: 'user',
          content: `
            Find current Web3 trends from the past 7 days.
            
            Rules:
            - Title: max 10 words
            - Description: 1–2 sentences
            - Tags: choose from ["defi","nft","ai","layer2","regulation","gaming","infrastructure"]
            - Include source_url
            - No duplicates
                  `,
        },
      ],
      search_recency_filter: 'week',
    });

    const raw = response.choices[0].message.content;

    function safeParse(content: string) {
      try {
        return JSON.parse(content);
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Invalid JSON');
        return JSON.parse(match[0]);
      }
    }

    const data = safeParse(raw as string);

    return this.saveTrendsToDatabase(
      data.results.map((result) => ({
        title: result.title,
        description: result.description,
        tags: result.tags,
      })),
    );
  }

  async saveTrendsToDatabase(data: Trends[]): Promise<Trends[]> {
    let newTrends: Trends[] = [];
    for (const trend of data) {
      const [newTrend] = await db.insert(trends).values(trend).returning();
      newTrends.push(newTrend as Trends);
    }
    return newTrends;
  }
}
