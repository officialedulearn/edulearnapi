import * as jwt from 'jsonwebtoken';
import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway', () => {
  const jwtSecret = 'test-secret';
  let gateway: RealtimeGateway;
  let redisService: Record<string, jest.Mock>;
  let communityService: Record<string, jest.Mock>;
  let publisher: Record<string, jest.Mock>;

  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = jwtSecret;
    redisService = {
      addOnlineUser: jest.fn(),
      getOnlineUsersCount: jest.fn().mockResolvedValue(7),
      getUserRooms: jest.fn().mockResolvedValue([]),
      cleanupUserPresence: jest.fn(),
      addUserToRoom: jest.fn(),
      removeUserFromRoom: jest.fn(),
      clearTyping: jest.fn(),
      getRoomStats: jest.fn().mockResolvedValue({
        onlineUsers: ['user-1'],
        onlineCount: 1,
        typingUsers: [],
      }),
    };
    communityService = {
      getDisplayNameForSocket: jest.fn().mockResolvedValue('ada'),
      isUserMember: jest.fn(),
    };
    publisher = {
      bindServer: jest.fn(),
      getCommunityRoomName: jest.fn((communityId: string) => {
        return `community:${communityId}`;
      }),
      publishToCommunityRoom: jest.fn(),
    };
    gateway = new RealtimeGateway(
      redisService as any,
      communityService as any,
      publisher as any,
    );
  });

  it('accepts a valid Supabase JWT and emits realtime.connected', async () => {
    const token = jwt.sign({ sub: 'user-1', email: 'ada@example.com' }, jwtSecret);
    const client = {
      id: 'socket-1',
      handshake: { auth: { token }, headers: {} },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(client as any);

    expect(redisService.addOnlineUser).toHaveBeenCalledWith('user-1');
    expect(client.emit).toHaveBeenCalledWith('realtime.connected', {
      userId: 'user-1',
      username: 'ada',
      onlineUsers: 7,
    });
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('rejects a connection without a token', async () => {
    const client = {
      id: 'socket-1',
      handshake: { auth: {}, headers: {} },
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    await gateway.handleConnection(client as any);

    expect(client.disconnect).toHaveBeenCalled();
    expect(redisService.addOnlineUser).not.toHaveBeenCalled();
  });

  it('validates community membership before subscribing to a room', async () => {
    communityService.isUserMember.mockResolvedValue(true);
    const client = {
      userId: 'user-1',
      username: 'ada',
      join: jest.fn(),
      emit: jest.fn(),
    };
    const subscription = { channel: 'community.room' as const, id: 'room-1' };

    const result = await gateway.handleSubscribe(client as any, subscription);

    expect(communityService.isUserMember).toHaveBeenCalledWith(
      'user-1',
      'room-1',
    );
    expect(client.join).toHaveBeenCalledWith('community:room-1');
    expect(client.emit).toHaveBeenCalledWith(
      'subscription.ready',
      expect.objectContaining({ subscription, onlineCount: 1 }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
      }),
    );
  });

  it('emits subscription.error when community membership fails', async () => {
    communityService.isUserMember.mockResolvedValue(false);
    const client = {
      userId: 'user-1',
      username: 'ada',
      join: jest.fn(),
      emit: jest.fn(),
    };
    const subscription = { channel: 'community.room' as const, id: 'room-1' };

    const result = await gateway.handleSubscribe(client as any, subscription);

    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('subscription.error', {
      subscription,
      error: 'You are not a member of this community',
    });
    expect(result).toEqual({
      error: 'You are not a member of this community',
    });
  });
});
