import { Injectable, Logger } from '@nestjs/common';
import { CardsService } from 'src/cards/cards.service';
import { LeaderboardService } from 'src/leaderboard/leaderboard.service';
import { TwitterService } from 'src/twitter/twitter.service';

@Injectable()
export class MonthlyLeaderboardService {
  private readonly logger = new Logger(MonthlyLeaderboardService.name);

  constructor(
    private readonly cardsService: CardsService,
    private readonly leaderboardService: LeaderboardService,
    private readonly twitterService: TwitterService,
  ) {}

  private monthLabel(year: number, month: number): string {
    return new Date(year, month - 1, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }

  async buildPreviewPng(options: {
    year: number;
    month: number;
    theme?: 'light' | 'dark';
    mock?: boolean;
  }): Promise<Buffer> {
    const { year, month, theme, mock } = options;

    if (mock) {
      return this.cardsService.generateMonthlyLeaderboardCard({
        monthLabel: this.monthLabel(year, month),
        theme,
        entries: [
          {
            rank: 1,
            username: 'toplearner',
            name: 'Alex Chen',
            xp: 12450,
            avatarUrl: null,
          },
          {
            rank: 2,
            username: 'studyhero',
            name: 'Jordan Smith',
            xp: 9820,
            avatarUrl: null,
          },
          {
            rank: 3,
            username: 'quizking',
            name: 'Sam Rivera',
            xp: 8740,
            avatarUrl: null,
          },
        ],
      });
    }

    const leaders = await this.leaderboardService.getMonthlyXpLeaders(
      year,
      month,
    );

    if (leaders.length === 0) {
      return this.cardsService.generateMonthlyLeaderboardCard({
        monthLabel: this.monthLabel(year, month),
        theme,
        entries: [],
      });
    }

    const entries = leaders.map((l) => ({
      rank: l.rank as 1 | 2 | 3,
      username: l.user.username || 'user',
      name: l.user.name || l.user.username || 'User',
      xp: l.totalXp,
      avatarUrl: l.user.profilePictureURL,
    }));

    return this.cardsService.generateMonthlyLeaderboardCard({
      monthLabel: this.monthLabel(year, month),
      theme,
      entries,
    });
  }

  async postMonthToX(year: number, month: number): Promise<void> {
    const leaders = await this.leaderboardService.getMonthlyXpLeaders(
      year,
      month,
    );

    if (leaders.length === 0) {
      this.logger.log(
        `Monthly leaderboard: no weekly XP data for ${year}-${month}, skipping X post`,
      );
      return;
    }

    const png = await this.cardsService.generateMonthlyLeaderboardCard({
      monthLabel: this.monthLabel(year, month),
      theme: 'dark',
      entries: leaders.map((l) => ({
        rank: l.rank as 1 | 2 | 3,
        username: l.user.username || 'user',
        name: l.user.name || l.user.username || 'User',
        xp: l.totalXp,
        avatarUrl: l.user.profilePictureURL,
      })),
    });

    const mediaId = await this.twitterService.uploadMediaBuffer(png);
    const label = this.monthLabel(year, month);
    const lines = leaders.map(
      (l, i) =>
        `${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} @${l.user.username || 'user'} — ${l.totalXp.toLocaleString()} XP`,
    );
    const text = [
      `🏆 EduLearn Monthly Leaderboard — ${label}`,
      '',
      ...lines,
      '',
      'Compete on edulearn.fun',
    ].join('\n');

    await this.twitterService.postTweet(text, {
      media: { media_ids: [mediaId] },
    });
    this.logger.log(`Posted monthly leaderboard card for ${label}`);
  }

  async postPreviousMonthToX(): Promise<void> {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    await this.postMonthToX(prev.getFullYear(), prev.getMonth() + 1);
  }
}
