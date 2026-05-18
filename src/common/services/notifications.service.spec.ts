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

  it('accepts roadmap_step_ready with roadmapId, stepId, and chatId', () => {
    expect(() =>
      validateNotificationMetadata('roadmap_step_ready', {
        roadmapId: 'roadmap-1',
        stepId: 'step-1',
        chatId: 'chat-1',
      }),
    ).not.toThrow();
  });

  it('rejects roadmap_step_ready without chatId', () => {
    expect(() =>
      validateNotificationMetadata('roadmap_step_ready', {
        roadmapId: 'roadmap-1',
        stepId: 'step-1',
      }),
    ).toThrow(BadRequestException);
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

  it('accepts agent_message with chatId and agentId', () => {
    expect(() =>
      validateNotificationMetadata('agent_message', {
        chatId: 'chat-1',
        agentId: 'agent-1',
      }),
    ).not.toThrow();
  });

  it('rejects agent_message without chatId', () => {
    expect(() =>
      validateNotificationMetadata('agent_message', {
        agentId: 'agent-1',
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts system_announcement with empty metadata', () => {
    expect(() =>
      validateNotificationMetadata('system_announcement', {}),
    ).not.toThrow();
  });
});
