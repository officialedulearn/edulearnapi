import { BadRequestException } from '@nestjs/common';
import { validateNotificationMetadata } from './notifications.service';

describe('validateNotificationMetadata', () => {
  it('accepts quiz_ready with quizId', () => {
    expect(() =>
      validateNotificationMetadata('quiz_ready', { quizId: 'quiz-1' }),
    ).not.toThrow();
  });

  it('rejects quiz_ready without quizId', () => {
    expect(() => validateNotificationMetadata('quiz_ready', {})).toThrow(
      BadRequestException,
    );
  });

  it('accepts mention with communityId', () => {
    expect(() =>
      validateNotificationMetadata('mention', { communityId: 'room-1' }),
    ).not.toThrow();
  });

  it('rejects nft_claimed without nftId', () => {
    expect(() => validateNotificationMetadata('nft_claimed', {})).toThrow(
      BadRequestException,
    );
  });

  it('accepts system_announcement with empty metadata', () => {
    expect(() =>
      validateNotificationMetadata('system_announcement', {}),
    ).not.toThrow();
  });
});

