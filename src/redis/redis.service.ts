import { Injectable, Inject } from '@nestjs/common';
import { RedisClientType } from 'redis';

@Injectable()
export class RedisService {
  constructor(@Inject('REDIS') private readonly redis: RedisClientType) {}

  // ==================== ONLINE USERS (GLOBAL) ====================

  /**
   * Add user to global online users set
   */
  async addOnlineUser(userId: string): Promise<void> {
    await this.redis.sAdd('online_users', userId);
  }

  /**
   * Remove user from global online users set
   */
  async removeOnlineUser(userId: string): Promise<void> {
    await this.redis.sRem('online_users', userId);
  }

  /**
   * Check if user is online globally
   */
  async isUserOnline(userId: string): Promise<boolean> {
    return Boolean(await this.redis.sIsMember('online_users', userId));
  }

  /**
   * Get all online users
   */
  async getOnlineUsers(): Promise<string[]> {
    return await this.redis.sMembers('online_users');
  }

  /**
   * Get count of online users
   */
  async getOnlineUsersCount(): Promise<number> {
    return await this.redis.sCard('online_users');
  }

  // ==================== ROOM PRESENCE ====================

  /**
   * Add user to room's online users set
   */
  async addUserToRoom(communityId: string, userId: string): Promise<void> {
    const key = `room:${communityId}:online`;
    await this.redis.sAdd(key, userId);
  }

  /**
   * Remove user from room's online users set
   */
  async removeUserFromRoom(communityId: string, userId: string): Promise<void> {
    const key = `room:${communityId}:online`;
    await this.redis.sRem(key, userId);
  }

  /**
   * Check if user is in a specific room
   */
  async isUserInRoom(communityId: string, userId: string): Promise<boolean> {
    const key = `room:${communityId}:online`;
    return Boolean(await this.redis.sIsMember(key, userId));
  }

  /**
   * Get all online users in a room
   */
  async getRoomOnlineUsers(communityId: string): Promise<string[]> {
    const key = `room:${communityId}:online`;
    return await this.redis.sMembers(key);
  }

  /**
   * Get count of online users in a room
   */
  async getRoomOnlineUsersCount(communityId: string): Promise<number> {
    const key = `room:${communityId}:online`;
    return await this.redis.sCard(key);
  }

  /**
   * Remove user from all rooms
   */
  async removeUserFromAllRooms(userId: string): Promise<void> {
    // Get all room keys
    const roomKeys = await this.redis.keys('room:*:online');

    // Remove user from each room
    const pipeline = this.redis.multi();
    for (const key of roomKeys) {
      pipeline.sRem(key, userId);
    }
    await pipeline.exec();
  }

  /**
   * Get all rooms a user is in
   */
  async getUserRooms(userId: string): Promise<string[]> {
    const roomKeys = await this.redis.keys('room:*:online');
    const rooms: string[] = [];

    for (const key of roomKeys) {
      const isMember = await this.redis.sIsMember(key, userId);
      if (isMember) {
        // Extract communityId from key "room:<communityId>:online"
        const communityId = key.split(':')[1];
        rooms.push(communityId);
      }
    }

    return rooms;
  }

  // ==================== TYPING INDICATORS ====================

  /**
   * Set typing indicator with TTL (3 seconds)
   */
  async setTyping(
    communityId: string,
    userId: string,
    ttl: number = 3,
  ): Promise<void> {
    const key = `typing:${communityId}:${userId}`;
    await this.redis.setEx(key, ttl, '1');
  }

  /**
   * Check if user is typing in a room
   */
  async isTyping(communityId: string, userId: string): Promise<boolean> {
    const key = `typing:${communityId}:${userId}`;
    const result = await this.redis.exists(key);
    return result === 1;
  }

  /**
   * Get all users typing in a room
   */
  async getTypingUsers(communityId: string): Promise<string[]> {
    const pattern = `typing:${communityId}:*`;
    const keys = await this.redis.keys(pattern);

    // Extract userIds from keys
    return keys.map((key) => {
      const parts = key.split(':');
      return parts[2]; // userId is the third part
    });
  }

  /**
   * Clear typing indicator for a user
   */
  async clearTyping(communityId: string, userId: string): Promise<void> {
    const key = `typing:${communityId}:${userId}`;
    await this.redis.del(key);
  }

  /**
   * Clear all typing indicators for a room
   */
  async clearRoomTyping(communityId: string): Promise<void> {
    const pattern = `typing:${communityId}:*`;
    const keys = await this.redis.keys(pattern);

    if (keys.length > 0) {
      await this.redis.del(keys);
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Get user presence info
   */
  async getUserPresence(userId: string): Promise<{
    isOnline: boolean;
    rooms: string[];
  }> {
    const isOnline = await this.isUserOnline(userId);
    const rooms = isOnline ? await this.getUserRooms(userId) : [];

    return {
      isOnline,
      rooms,
    };
  }

  /**
   * Get room stats
   */
  async getRoomStats(communityId: string): Promise<{
    onlineCount: number;
    onlineUsers: string[];
    typingUsers: string[];
  }> {
    const [onlineUsers, typingUsers, onlineCount] = await Promise.all([
      this.getRoomOnlineUsers(communityId),
      this.getTypingUsers(communityId),
      this.getRoomOnlineUsersCount(communityId),
    ]);

    return {
      onlineCount,
      onlineUsers,
      typingUsers,
    };
  }

  /**
   * Clean up user presence (call on disconnect)
   */
  async cleanupUserPresence(userId: string): Promise<void> {
    await Promise.all([
      this.removeOnlineUser(userId),
      this.removeUserFromAllRooms(userId),
    ]);
  }

  /**
   * Ping to keep connection alive
   */
  async ping(): Promise<string> {
    return await this.redis.ping();
  }

  // ==================== ROADMAP CACHE ====================

  async getRoadmapPayload(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async setRoadmapPayload(
    key: string,
    ttlSeconds: number,
    payload: string,
  ): Promise<void> {
    await this.redis.setEx(key, ttlSeconds, payload);
  }

  async deleteRoadmapPayload(keys: string[]): Promise<void> {
    if (!keys.length) {
      return;
    }
    await this.redis.del(keys);
  }

  // ==================== STUDY SUGGESTIONS (Gemini cache) ====================

  async getStudySuggestionsPayload(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async setStudySuggestionsPayload(
    key: string,
    ttlSeconds: number,
    payload: string,
  ): Promise<void> {
    await this.redis.setEx(key, ttlSeconds, payload);
  }

  async getStudySuggestionsTtlSeconds(key: string): Promise<number> {
    return this.redis.ttl(key);
  }
}
