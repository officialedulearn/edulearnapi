import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { RedisService } from '../redis/redis.service';
import { CommunityService } from './community.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
}

function displayNameFromJwtPayload(payload: Record<string, unknown>): string | undefined {
  const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const email = payload.email;
  const fromEmail =
    typeof email === 'string' && email.includes('@') ? email.split('@')[0] : undefined;
  const pick = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
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
  namespace: '/community',
})
@Injectable()
export class CommunityGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CommunityGateway.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly communityService: CommunityService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Client ${client.id} connection rejected: No token provided`);
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
      
      if (!payload || !payload.sub) {
        this.logger.warn(`Client ${client.id} connection rejected: Invalid token`);
        client.disconnect();
        return;
      }

      client.userId = payload.sub;
      let resolvedName: string | null = null;
      try {
        resolvedName = await this.communityService.getDisplayNameForSocket(
          payload.sub as string,
        );
      } catch (e) {
        this.logger.warn(`Could not resolve username for socket user ${payload.sub}`);
      }
      client.username =
        resolvedName ??
        displayNameFromJwtPayload(payload as Record<string, unknown>) ??
        'User';

      await this.redisService.addOnlineUser(client.userId as unknown as string);

      this.server.emit('user_status', {
        userId: client.userId,
        username: client.username,
        status: 'online',
        timestamp: new Date().toISOString(),
      });

      const onlineCount = await this.redisService.getOnlineUsersCount();

      client.emit('connected', {
        userId: client.userId,
        username: client.username,
        onlineUsers: onlineCount,
      });

      this.logger.log(
        `User ${client.username} (${client.userId}) connected. Socket: ${client.id}`,
      );
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
        this.server.to(communityId).emit('room_user_left', {
          userId: client.userId,
          username: client.username,
          timestamp: new Date().toISOString(),
          onlineCount: roomStats.onlineCount,
        });
      }

      this.server.emit('user_status', {
        userId: client.userId,
        username: client.username,
        status: 'offline',
        timestamp: new Date().toISOString(),
      });

      this.logger.log(
        `User ${client.username} (${client.userId}) disconnected. Socket: ${client.id}`,
      );
    } catch (error) {
      this.logger.error(`Disconnect error for client ${client.id}:`, error);
    }
  }
  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { communityId: string; userId?: string },
  ) {
    try {
      const { communityId, userId } = data;
      const dbUserId = userId || client.userId;

      if (!dbUserId) {
        return { error: 'Unauthorized' };
      }

      if (!communityId) {
        this.logger.error('join_room called without communityId');
        return { error: 'Community ID is required' };
      }

      const isMember = await this.communityService.isUserMember(
        dbUserId,
        communityId,
      );

      if (!isMember) {
        return { error: 'You are not a member of this community' };
      }

      client.join(communityId);

      await this.redisService.addUserToRoom(communityId, dbUserId);

      const roomStats = await this.redisService.getRoomStats(communityId);

      this.server.to(communityId).emit('room_user_joined', {
        userId: dbUserId,
        username: client.username,
        timestamp: new Date().toISOString(),
        onlineCount: roomStats.onlineCount,
      });

      client.emit('room_joined', {
        communityId,
        onlineUsers: roomStats.onlineUsers,
        onlineCount: roomStats.onlineCount,
      });

      this.logger.log(
        `User ${client.username} joined room ${communityId}`,
      );

      return { success: true, roomStats };
    } catch (error) {
      this.logger.error('Error joining room:', error);
      return { error: 'Failed to join room' };
    }
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { communityId: string },
  ) {
    try {
      const { communityId } = data;

      if (!client.userId) {
        return { error: 'Unauthorized' };
      }

      client.leave(communityId);

      await this.redisService.removeUserFromRoom(communityId, client.userId);

      await this.redisService.clearTyping(communityId, client.userId);

      const roomStats = await this.redisService.getRoomStats(communityId);

      this.server.to(communityId).emit('room_user_left', {
        userId: client.userId,
        username: client.username,
        timestamp: new Date().toISOString(),
        onlineCount: roomStats.onlineCount,
      });

      this.logger.log(
        `User ${client.username} left room ${communityId}`,
      );

      return { success: true };
    } catch (error) {
      this.logger.error('Error leaving room:', error);
      return { error: 'Failed to leave room' };
    }
  }

  @SubscribeMessage('typing_start')
  async handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { communityId: string },
  ) {
    try {
      const { communityId } = data;

      if (!client.userId) {
        return { error: 'Unauthorized' };
      }

      await this.redisService.setTyping(communityId, client.userId, 3);

      client.to(communityId).emit('user_typing', {
        userId: client.userId,
        username: client.username,
        communityId,
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Error handling typing start:', error);
      return { error: 'Failed to set typing indicator' };
    }
  }

  @SubscribeMessage('typing_stop')
  async handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { communityId: string },
  ) {
    try {
      const { communityId } = data;

      if (!client.userId) {
        return { error: 'Unauthorized' };
      }

      await this.redisService.clearTyping(communityId, client.userId);

      client.to(communityId).emit('user_stopped_typing', {
        userId: client.userId,
        username: client.username,
        communityId,
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Error handling typing stop:', error);
      return { error: 'Failed to clear typing indicator' };
    }
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      communityId: string;
      content: string;
      mentionedUserIds?: string[];
      userId?: string;
    },
  ) {
    try {
      const { communityId, content, mentionedUserIds, userId } = data;
      const dbUserId = userId || client.userId;

      if (!dbUserId) {
        return { error: 'Unauthorized' };
      }

      const isMember = await this.communityService.isUserMember(
        dbUserId,
        communityId,
      );

      if (!isMember) {
        return { error: 'You are not a member of this community' };
      }

      const message = await this.communityService.createMessage({
        roomId: communityId,
        userId: dbUserId,
        content,
      });

      if (mentionedUserIds && mentionedUserIds.length > 0) {
        for (const mentionedUserId of mentionedUserIds) {
          await this.communityService.createMention({
            messageId: message.id,
            mentionedUserId,
            mentionedByUserId: dbUserId,
            communityId: communityId,
          });
        }
      }

      await this.redisService.clearTyping(communityId, dbUserId);

      const fullMessage = await this.communityService.getMessageById(
        message.id,
      );

      this.server.to(communityId).emit('new_message', {
        ...fullMessage,
        mentionedUserIds,
      });

      this.logger.log(
        `User ${client.username} sent message in room ${communityId}`,
      );

      return { success: true, message: fullMessage };
    } catch (error) {
      this.logger.error('Error sending message:', error);
      
      if (error?.cause?.code === 'ECONNRESET' || error?.code === 'ECONNRESET') {
        this.logger.error('Database connection was reset. This may be a transient issue.');
        return { 
          error: 'Database connection error. Please try again.',
          retryable: true 
        };
      }
      
      if (error?.query) {
        this.logger.error('Database query failed:', {
          query: error.query,
          params: error.params,
          cause: error.cause
        });
        return { 
          error: 'Failed to save message. Please try again.',
          retryable: true 
        };
      }
      
      return { error: 'Failed to send message' };
    }
  }

  @SubscribeMessage('delete_message')
  async handleDeleteMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string; communityId: string },
  ) {
    try {
      const { messageId, communityId } = data;

      if (!client.userId) {
        return { error: 'Unauthorized' };
      }

      const message = await this.communityService.getMessageById(messageId);

      if (!message) {
        return { error: 'Message not found' };
      }

      const role = await this.communityService.getMemberRole(
        client.userId,
        communityId,
      );

      if (message.user.id !== client.userId && role !== 'mod') {
        return { error: 'You do not have permission to delete this message' };
      }

      await this.communityService.deleteMessage(messageId);

      this.server.to(communityId).emit('message_deleted', {
        messageId,
        communityId,
        deletedBy: client.userId,
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Error deleting message:', error);
      return { error: 'Failed to delete message' };
    }
  }

  @SubscribeMessage('add_reaction')
  async handleAddReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      messageId: string;
      communityId: string;
      reaction: string;
    },
  ) {
    try {
      const { messageId, communityId, reaction } = data;

      if (!client.userId) {
        return { error: 'Unauthorized' };
      }

      const reactionResult = await this.communityService.addReaction({
        messageId,
        userId: client.userId,
        reaction,
      });

      const reactionCounts =
        await this.communityService.getReactionCountByType(messageId);

      this.server.to(communityId).emit('reaction_added', {
        messageId,
        reaction,
        userId: client.userId,
        username: client.username,
        reactionCounts,
        timestamp: new Date().toISOString(),
      });

      return { success: true, reaction: reactionResult };
    } catch (error) {
      this.logger.error('Error adding reaction:', error);
      return { error: 'Failed to add reaction' };
    }
  }

  @SubscribeMessage('remove_reaction')
  async handleRemoveReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      messageId: string;
      communityId: string;
    },
  ) {
    try {
      const { messageId, communityId } = data;

      if (!client.userId) {
        return { error: 'Unauthorized' };
      }

      await this.communityService.removeReaction(messageId, client.userId);

      const reactionCounts =
        await this.communityService.getReactionCountByType(messageId);

      this.server.to(communityId).emit('reaction_removed', {
        messageId,
        userId: client.userId,
        reactionCounts,
        timestamp: new Date().toISOString(),
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Error removing reaction:', error);
      return { error: 'Failed to remove reaction' };
    }
  }
    
  @SubscribeMessage('get_online_users')
  async handleGetOnlineUsers(@ConnectedSocket() client: AuthenticatedSocket) {
    try {
      const onlineUsers = await this.redisService.getOnlineUsers();
      const onlineCount = onlineUsers.length;

      return { success: true, onlineUsers, onlineCount };
    } catch (error) {
      this.logger.error('Error getting online users:', error);
      return { error: 'Failed to get online users' };
    }
  }

  @SubscribeMessage('get_room_presence')
  async handleGetRoomPresence(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { communityId: string },
  ) {
    try {
      const { communityId } = data;
      const roomStats = await this.redisService.getRoomStats(communityId);

      return { success: true, ...roomStats };
    } catch (error) {
      this.logger.error('Error getting room presence:', error);
      return { error: 'Failed to get room presence' };
    }
  }
}

