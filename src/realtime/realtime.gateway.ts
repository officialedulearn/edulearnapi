import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { RedisService } from '../redis/redis.service';
import { CommunityService } from '../community/community.service';
import { RealtimePublisherService } from './realtime.publisher';
import type { RealtimeSubscription } from './realtime.types';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
}

function displayNameFromJwtPayload(
  payload: Record<string, unknown>,
): string | undefined {
  const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const email = payload.email;
  const fromEmail =
    typeof email === 'string' && email.includes('@')
      ? email.split('@')[0]
      : undefined;
  const pick = (v: unknown) =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  return (
    pick(payload.username) ||
    pick(meta.username) ||
    pick(meta.preferred_username) ||
    pick(meta.full_name) ||
    pick(meta.name) ||
    fromEmail
  );
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/socket',
})
@Injectable()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => CommunityService))
    private readonly communityService: CommunityService,
    private readonly publisher: RealtimePublisherService,
  ) {}

  afterInit(server: Server): void {
    this.publisher.bindServer(server);
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Client ${client.id} rejected: No token provided`);
        client.disconnect();
        return;
      }

      const jwtSecret = process.env.SUPABASE_JWT_SECRET;
      if (!jwtSecret) {
        this.logger.error('SUPABASE_JWT_SECRET is not configured');
        client.disconnect();
        return;
      }

      const payload: any = jwt.verify(token, jwtSecret);
      if (!payload?.sub) {
        this.logger.warn(`Client ${client.id} rejected: Invalid token`);
        client.disconnect();
        return;
      }

      const userId = payload.sub as string;
      client.userId = userId;
      const resolvedName = await this.communityService
        .getDisplayNameForSocket(userId)
        .catch(() => null);
      client.username =
        resolvedName ??
        displayNameFromJwtPayload(payload as Record<string, unknown>) ??
        'User';

      await this.redisService.addOnlineUser(userId);
      const onlineCount = await this.redisService.getOnlineUsersCount();

      client.emit('realtime.connected', {
        userId,
        username: client.username,
        onlineUsers: onlineCount,
      });
    } catch (error) {
      this.logger.error(`Connection error for client ${client.id}:`, error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (!client.userId) return;

    try {
      const communityIds = await this.redisService.getUserRooms(client.userId);
      await this.redisService.cleanupUserPresence(client.userId);

      for (const communityId of communityIds) {
        const roomStats = await this.redisService.getRoomStats(communityId);
        this.publisher.publishToCommunityRoom(
          communityId,
          'community.room.user_left',
          {
            communityId,
            userId: client.userId,
            username: client.username,
            timestamp: new Date().toISOString(),
            onlineCount: roomStats.onlineCount,
            onlineUsers: roomStats.onlineUsers,
          },
        );
      }
    } catch (error) {
      this.logger.error(`Disconnect error for client ${client.id}:`, error);
    }
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() subscription: RealtimeSubscription,
  ) {
    if (!client.userId) {
      return this.subscriptionError(client, subscription, 'Unauthorized');
    }

    if (subscription?.channel !== 'community.room' || !subscription.id) {
      return this.subscriptionError(
        client,
        subscription,
        'Unsupported subscription',
      );
    }

    const communityId = subscription.id;
    const isMember = await this.communityService.isUserMember(
      client.userId,
      communityId,
    );

    if (!isMember) {
      return this.subscriptionError(
        client,
        subscription,
        'You are not a member of this community',
      );
    }

    const roomName = this.publisher.getCommunityRoomName(communityId);
    client.join(roomName);
    await this.redisService.addUserToRoom(communityId, client.userId);
    const roomStats = await this.redisService.getRoomStats(communityId);

    client.emit('subscription.ready', {
      subscription,
      onlineUsers: roomStats.onlineUsers,
      onlineCount: roomStats.onlineCount,
    });

    this.publisher.publishToCommunityRoom(
      communityId,
      'community.room.user_joined',
      {
        communityId,
        userId: client.userId,
        username: client.username,
        timestamp: new Date().toISOString(),
        onlineCount: roomStats.onlineCount,
        onlineUsers: roomStats.onlineUsers,
      },
    );

    return { success: true, roomStats };
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() subscription: RealtimeSubscription,
  ) {
    if (!client.userId) {
      return this.subscriptionError(client, subscription, 'Unauthorized');
    }

    if (subscription?.channel !== 'community.room' || !subscription.id) {
      return this.subscriptionError(
        client,
        subscription,
        'Unsupported subscription',
      );
    }

    const communityId = subscription.id;
    const roomName = this.publisher.getCommunityRoomName(communityId);
    client.leave(roomName);
    await this.redisService.removeUserFromRoom(communityId, client.userId);
    await this.redisService.clearTyping(communityId, client.userId);
    const roomStats = await this.redisService.getRoomStats(communityId);

    this.publisher.publishToCommunityRoom(
      communityId,
      'community.room.user_left',
      {
        communityId,
        userId: client.userId,
        username: client.username,
        timestamp: new Date().toISOString(),
        onlineCount: roomStats.onlineCount,
        onlineUsers: roomStats.onlineUsers,
      },
    );

    return { success: true };
  }

  private subscriptionError(
    client: AuthenticatedSocket,
    subscription: RealtimeSubscription | undefined,
    error: string,
  ) {
    client.emit('subscription.error', { subscription, error });
    return { error };
  }
}
