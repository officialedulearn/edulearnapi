import { Injectable, Inject, forwardRef, BadRequestException } from '@nestjs/common';
import { eq, and, desc, sql, ilike, or, inArray } from 'drizzle-orm';
import db from '../../drizzle';
import {
  community,
  roomMessage,
  messageReaction,
  mention,
  community_members,
  community_join_request,
  user,
  type Community,
  type roomMessage as RoomMessage,
  type MessageReaction,
  type Mention,
  type CommunityMembers,
  type CommunityJoinRequest,
} from 'lib/db/schema';
import { NotificationsService } from 'src/common/services/notifications.service';
import { AuthService } from 'src/auth/auth.service';

@Injectable()
export class CommunityService {
  constructor(
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => AuthService))
    private readonly authService: AuthService,
  ) {}

  private async buildReactionEnrichment(messageIds: string[], viewerUserId?: string | null): Promise<
    Record<
      string,
      {
        reactionCounts: Record<string, number>;
        groupedReactionCounts: { reaction: string; count: number }[];
        currentUserReaction: string | null;
      }
    >
  > {
    const emptyShape = (): {
      reactionCounts: Record<string, number>;
      groupedReactionCounts: { reaction: string; count: number }[];
      currentUserReaction: string | null;
    } => ({
      reactionCounts: {},
      groupedReactionCounts: [],
      currentUserReaction: null,
    });

    const out: Record<
      string,
      {
        reactionCounts: Record<string, number>;
        groupedReactionCounts: { reaction: string; count: number }[];
        currentUserReaction: string | null;
      }
    > = {};
    if (messageIds.length === 0) {
      return out;
    }

    for (const id of messageIds) {
      out[id] = emptyShape();
    }

    const aggregates = await db
      .select({
        messageId: messageReaction.messageId,
        reaction: messageReaction.reaction,
        count: sql<number>`count(*)`,
      })
      .from(messageReaction)
      .where(inArray(messageReaction.messageId, messageIds))
      .groupBy(messageReaction.messageId, messageReaction.reaction);

    for (const row of aggregates) {
      const bucket = out[row.messageId] ?? emptyShape();
      bucket.reactionCounts[row.reaction] = Number(row.count);
      bucket.groupedReactionCounts.push({
        reaction: row.reaction,
        count: Number(row.count),
      });
      out[row.messageId] = bucket;
    }

    if (viewerUserId) {
      const mine = await db
        .select({
          messageId: messageReaction.messageId,
          reaction: messageReaction.reaction,
        })
        .from(messageReaction)
        .where(
          and(
            inArray(messageReaction.messageId, messageIds),
            eq(messageReaction.userId, viewerUserId),
          ),
        );
      for (const row of mine) {
        const bucket = out[row.messageId] ?? emptyShape();
        bucket.currentUserReaction = row.reaction;
        out[row.messageId] = bucket;
      }
    }

    return out;
  }

  async createCommunity(data: {
    title: string;
    inviteCode: string;
    visibility?: 'public' | 'private';
    imageUrl?: string;
  }): Promise<Community> {
    const [newCommunity] = await db.insert(community).values(data).returning();
    return newCommunity;
  }

  async getCommunityById(communityId: string): Promise<Community | null> {
    const [result] = await db
      .select()
      .from(community)
      .where(eq(community.id, communityId))
      .limit(1);
    return result || null;
  }

  async getCommunityByInviteCode(
    inviteCode: string,
  ): Promise<Community | null> {
    const [result] = await db
      .select()
      .from(community)
      .where(eq(community.inviteCode, inviteCode))
      .limit(1);
    return result || null;
  }

  async getPublicCommunities(): Promise<Community[]> {
    return await db
      .select()
      .from(community)
      .where(eq(community.visibility, 'public'))
      .orderBy(desc(community.createdAt));
  }

  async getAllCommunities(): Promise<Community[]> {
    return await db.select().from(community).orderBy(desc(community.createdAt));
  }

  async updateCommunity(
    communityId: string,
    data: Partial<{
      title: string;
      visibility: 'public' | 'private';
      imageUrl: string;
      inviteCode: string;
    }>,
  ): Promise<Community> {
    const [updated] = await db
      .update(community)
      .set(data)
      .where(eq(community.id, communityId))
      .returning();
    return updated;
  }

  async deleteCommunity(communityId: string): Promise<void> {
    await db.delete(community).where(eq(community.id, communityId));
  }

  async addMemberToCommunity(data: {
    userId: string;
    communityId: string;
    role?: 'mod' | 'member';
  }): Promise<CommunityMembers> {
    const [member] = await db
      .insert(community_members)
      .values(data)
      .returning();
    return member;
  }

  async getCommunityMembers(communityId: string) {
    return await db
      .select({
        id: community_members.id,
        role: community_members.role,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          profilePictureURL: user.profilePictureURL,
          level: user.level,
        },
      })
      .from(community_members)
      .innerJoin(user, eq(community_members.userId, user.id))
      .where(eq(community_members.communityId, communityId));
  }

  async getUserCommunities(userId: string) {
    return await db
      .select({
        id: community.id,
        title: community.title,
        imageUrl: community.imageUrl,
        visibility: community.visibility,
        createdAt: community.createdAt,
        role: community_members.role,
      })
      .from(community_members)
      .innerJoin(community, eq(community_members.communityId, community.id))
      .where(eq(community_members.userId, userId))
      .orderBy(desc(community.createdAt));
  }

  async isUserMember(userId: string, communityId: string): Promise<boolean> {
    const [result] = await db
      .select()
      .from(community_members)
      .where(
        and(
          eq(community_members.userId, userId),
          eq(community_members.communityId, communityId),
        ),
      )
      .limit(1);
    return !!result;
  }

  async getMemberRole(
    userId: string,
    communityId: string,
  ): Promise<'mod' | 'member' | null> {
    const [result] = await db
      .select()
      .from(community_members)
      .where(
        and(
          eq(community_members.userId, userId),
          eq(community_members.communityId, communityId),
        ),
      )
      .limit(1);
    return result?.role || null;
  }

  async updateMemberRole(
    userId: string,
    communityId: string,
    role: 'mod' | 'member',
  ): Promise<CommunityMembers> {
    const [updated] = await db
      .update(community_members)
      .set({ role })
      .where(
        and(
          eq(community_members.userId, userId),
          eq(community_members.communityId, communityId),
        ),
      )
      .returning();
    return updated;
  }

  async removeMemberFromCommunity(
    userId: string,
    communityId: string,
  ): Promise<void> {
    await db
      .delete(community_members)
      .where(
        and(
          eq(community_members.userId, userId),
          eq(community_members.communityId, communityId),
        ),
      );
  }

  async getCommunityMemberCount(communityId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(community_members)
      .where(eq(community_members.communityId, communityId));
    return Number(result[0]?.count || 0);
  }

  async createJoinRequest(data: {
    userId: string;
    communityId: string;
  }): Promise<CommunityJoinRequest> {

    const existingRequest = await this.getUserJoinRequest(data.userId, data.communityId);
    if (existingRequest) {
      throw new BadRequestException('You have already requested to join this community');
    }

    const [request] = await db
      .insert(community_join_request)
      .values(data)
      .returning();

    try {
      const mods = await this.getAllCommunityMods(data.communityId);
      const community = await this.getCommunityById(data.communityId);
      const requestingUser = await db
        .select({
          id: user.id,
          username: user.username,
          name: user.name,
        })
        .from(user)
        .where(eq(user.id, data.userId))
        .limit(1);

      const requester = requestingUser[0];
      const communityTitle = community?.title || 'Community';

      if (requester && mods.length > 0) {
        for (const mod of mods) {
          await this.notificationsService.createNotification({
            title: `New join request for ${communityTitle}`,
            content: `${requester.name || requester.username} wants to join ${communityTitle}`,
            userId: mod.userId,
            type: 'mention',
            metadata: { communityId: data.communityId },
          });
        }
      }
    } catch (error) {
      console.error('Failed to notify mods about join request:', error);
    }

    return request;
  }

  async getPendingJoinRequests(communityId: string) {
    return await db
      .select({
        id: community_join_request.id,
        createdAt: community_join_request.createdAt,
        status: community_join_request.status,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          profilePictureURL: user.profilePictureURL,
        },
      })
      .from(community_join_request)
      .innerJoin(user, eq(community_join_request.userId, user.id))
      .where(
        and(
          eq(community_join_request.communityId, communityId),
          eq(community_join_request.status, 'pending'),
        ),
      )
      .orderBy(desc(community_join_request.createdAt));
  }

  async getUserJoinRequest(
    userId: string,
    communityId: string,
  ): Promise<CommunityJoinRequest | null> {
    const [request] = await db
      .select()
      .from(community_join_request)
      .where(
        and(
          eq(community_join_request.userId, userId),
          eq(community_join_request.communityId, communityId),
        ),
      )
      .orderBy(desc(community_join_request.createdAt))
      .limit(1);
    return request || null;
  }

  async updateJoinRequestStatus(
    requestId: string,
    status: 'approved' | 'rejected',
  ): Promise<CommunityJoinRequest> {
    const [updated] = await db
      .update(community_join_request)
      .set({ status })
      .where(eq(community_join_request.id, requestId))
      .returning();
    return updated;
  }

  async deleteJoinRequest(requestId: string): Promise<void> {
    await db
      .delete(community_join_request)
      .where(eq(community_join_request.id, requestId));
  }
  async createMessage(data: {
    roomId: string;
    userId: string;
    content: string;
  }): Promise<RoomMessage> {
    try {
      const [message] = await db.insert(roomMessage).values(data).returning();
      return message;
    } catch (error) {
      console.error('Error creating message:', error);
      if (error?.cause?.code === 'ECONNRESET' || error?.code === 'ECONNRESET') {
        throw new Error('Database connection was reset. Please try again.');
      }
      throw error;
    }
  }
  async getRoomMessages(
    roomId: string,
    limit: number = 50,
    offset: number = 0,
    viewerUserId?: string | null,
    opts?: { moderatorUserIdKnown?: string | null },
  ) {
    const moderatorUserId =
      opts && 'moderatorUserIdKnown' in opts
        ? opts.moderatorUserIdKnown ?? null
        : (await this.getCommunityMod(roomId).catch(() => null))?.user.id ??
          null;

    const rows = await db
      .select({
        id: roomMessage.id,
        content: roomMessage.content,
        createdAt: roomMessage.createdAt,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          profilePictureURL: user.profilePictureURL,
          level: user.level,
        },
      })
      .from(roomMessage)
      .innerJoin(user, eq(roomMessage.userId, user.id))
      .where(eq(roomMessage.roomId, roomId))
      .orderBy(desc(roomMessage.createdAt))
      .limit(limit)
      .offset(offset);

    const ids = rows.map((r) => r.id);
    const enrichment = await this.buildReactionEnrichment(ids, viewerUserId);

    return rows.map((row) => {
      const e = enrichment[row.id] ?? {
        reactionCounts: {} as Record<string, number>,
        groupedReactionCounts: [] as { reaction: string; count: number }[],
        currentUserReaction: null as string | null,
      };
      return {
        ...row,
        reactionCounts: e.reactionCounts,
        groupedReactionCounts: e.groupedReactionCounts,
        currentUserReaction: e.currentUserReaction,
        myReaction: e.currentUserReaction,
        isModeratorMessage:
          moderatorUserId != null && row.user.id === moderatorUserId,
      };
    });
  }

  async getCommunityChatBootstrap(
    communityId: string,
    viewerUserId: string,
    options?: {
      messagesLimit?: number;
      messagesOffset?: number;
    },
  ) {
    const limit = options?.messagesLimit ?? 20;
    const offset = options?.messagesOffset ?? 0;

    const [communityRow, moderator] = await Promise.all([
      this.getCommunityById(communityId),
      this.getCommunityMod(communityId).catch(() => null),
    ]);
    if (!communityRow) {
      return null;
    }

    const [role, members, membersCount, messages] = await Promise.all([
      this.getMemberRole(viewerUserId, communityId),
      this.getCommunityMembers(communityId),
      this.getCommunityMemberCount(communityId),
      this.getRoomMessages(communityId, limit, offset, viewerUserId, {
        moderatorUserIdKnown: moderator?.user.id ?? null,
      }),
    ]);

    const pendingJoinRequests =
      moderator && moderator.user.id === viewerUserId
        ? await this.getPendingJoinRequests(communityId)
        : [];

    return {
      community: communityRow,
      viewer: {
        userId: viewerUserId,
        role,
        isModerator: role === 'mod',
      },
      moderator,
      members,
      membersCount,
      pendingJoinRequests,
      messages,
      messagesPagination: {
        limit,
        offset,
        hasMore: messages.length === limit,
        nextOffset: offset + messages.length,
      },
    };
  }

  async getMessageById(messageId: string) {
    const [message] = await db
      .select({
        id: roomMessage.id,
        content: roomMessage.content,
        createdAt: roomMessage.createdAt,
        roomId: roomMessage.roomId,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          profilePictureURL: user.profilePictureURL,
        },
      })
      .from(roomMessage)
      .innerJoin(user, eq(roomMessage.userId, user.id))
      .where(eq(roomMessage.id, messageId))
      .limit(1);
    return message || null;
  }

  async updateMessage(
    messageId: string,
    content: string,
  ): Promise<RoomMessage> {
    const [updated] = await db
      .update(roomMessage)
      .set({ content })
      .where(eq(roomMessage.id, messageId))
      .returning();
    return updated;
  }
  async deleteMessage(messageId: string): Promise<void> {
    await db
      .delete(messageReaction)
      .where(eq(messageReaction.messageId, messageId));

    await db.delete(mention).where(eq(mention.messageId, messageId));

    await db.delete(roomMessage).where(eq(roomMessage.id, messageId));
  }
  async getRoomMessageCount(roomId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(roomMessage)
      .where(eq(roomMessage.roomId, roomId));
    return Number(result[0]?.count || 0);
  }
  async addReaction(data: {
    messageId: string;
    userId: string;
    reaction: string;
  }): Promise<MessageReaction> {
    const [reactionResult] = await db
      .insert(messageReaction)
      .values(data)
      .returning();
    return reactionResult;
  }
  async getMessageReactions(messageId: string) {
    return await db
      .select({
        id: messageReaction.id,
        reaction: messageReaction.reaction,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          profilePictureURL: user.profilePictureURL,
        },
      })
      .from(messageReaction)
      .innerJoin(user, eq(messageReaction.userId, user.id))
      .where(eq(messageReaction.messageId, messageId));
  }

  async getUserReaction(
    messageId: string,
    userId: string,
  ): Promise<MessageReaction | null> {
    const [reaction] = await db
      .select()
      .from(messageReaction)
      .where(
        and(
          eq(messageReaction.messageId, messageId),
          eq(messageReaction.userId, userId),
        ),
      )
      .limit(1);
    return reaction || null;
  }

  async removeReaction(messageId: string, userId: string): Promise<void> {
    await db
      .delete(messageReaction)
      .where(
        and(
          eq(messageReaction.messageId, messageId),
          eq(messageReaction.userId, userId),
        ),
      );
  }

  async removeReactionById(reactionId: string): Promise<void> {
    await db.delete(messageReaction).where(eq(messageReaction.id, reactionId));
  }

  async getReactionCountByType(messageId: string) {
    return await db
      .select({
        reaction: messageReaction.reaction,
        count: sql<number>`count(*)`,
      })
      .from(messageReaction)
      .where(eq(messageReaction.messageId, messageId))
      .groupBy(messageReaction.reaction);
  }

  async updateModStatusBasedOnXP(userId: string): Promise<void> {
    try {
      const userCommunities = await db
        .select({
          communityId: community_members.communityId,
        })
        .from(community_members)
        .where(eq(community_members.userId, userId));

      for (const { communityId } of userCommunities) {
        await this.checkAndUpdateCommunityMod(communityId);
      }
    } catch (error) {
      console.error('Error updating mod status based on XP:', error);
      throw error;
    }
  }
  async checkAndUpdateCommunityMod(communityId: string): Promise<void> {
    try {
      const members = await db
        .select({
          userId: community_members.userId,
          role: community_members.role,
          xp: user.xp,
        })
        .from(community_members)
        .innerJoin(user, eq(community_members.userId, user.id))
        .where(eq(community_members.communityId, communityId))
        .orderBy(desc(user.xp));

      if (members.length === 0) return;

      const highestXpUser = members[0];

      if (highestXpUser.role === 'mod') return;

      await db
        .update(community_members)
        .set({ role: 'member' })
        .where(
          and(
            eq(community_members.communityId, communityId),
            eq(community_members.role, 'mod'),
          ),
        );
      await db
        .update(community_members)
        .set({ role: 'mod' })
        .where(
          and(
            eq(community_members.communityId, communityId),
            eq(community_members.userId, highestXpUser.userId),
          ),
        );

      console.log(
        `✅ User ${highestXpUser.userId} is now mod of community ${communityId} (XP: ${highestXpUser.xp})`,
      );
    } catch (error) {
      console.error('Error checking and updating community mod:', error);
      throw error;
    }
  }

  async getCommunityMod(communityId: string) {
    const [mod] = await db
      .select({
        id: community_members.id,
        userId: community_members.userId,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          xp: user.xp,
          level: user.level,
          profilePictureURL: user.profilePictureURL,
        },
      })
      .from(community_members)
      .innerJoin(user, eq(community_members.userId, user.id))
      .where(
        and(
          eq(community_members.communityId, communityId),
          eq(community_members.role, 'mod'),
        ),
      )
      .limit(1);

    return mod || null;
  }

  async getAllCommunityMods(communityId: string) {
    return await db
      .select({
        id: community_members.id,
        userId: community_members.userId,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          xp: user.xp,
          level: user.level,
          profilePictureURL: user.profilePictureURL,
        },
      })
      .from(community_members)
      .innerJoin(user, eq(community_members.userId, user.id))
      .where(
        and(
          eq(community_members.communityId, communityId),
          eq(community_members.role, 'mod'),
        ),
      );
  }

  async createMention(data: {
    messageId: string;
    mentionedUserId: string;
    mentionedByUserId?: string;
    communityId?: string;
  }): Promise<Mention> {
    const [mentionResult] = await db
      .insert(mention)
      .values({
        messageId: data.messageId,
        mentionedUserId: data.mentionedUserId,
      })
      .returning();

    try {
      const message = await this.getMessageById(data.messageId);
      const community = data.communityId
        ? await this.getCommunityById(data.communityId)
        : null;
      const mentionedBy = data.mentionedByUserId
        ? await db
            .select()
            .from(user)
            .where(eq(user.id, data.mentionedByUserId))
            .limit(1)
        : null;

      const mentionedByUser = mentionedBy?.[0];
      const communityTitle = community?.title || 'Community';
      const mentionedByName = mentionedByUser?.name || 'Someone';

      await this.notificationsService.createNotification({
        title: `${mentionedByName} mentioned you`,
        content: `You were mentioned in ${communityTitle}: ${message.content.substring(0, 100)}${message.content.length > 100 ? '...' : ''}`,
        userId: data.mentionedUserId,
        type: 'mention',
        metadata: {
          communityId: data.communityId ?? message.roomId,
          messageId: data.messageId,
          mentionedByUserId: data.mentionedByUserId,
        },
      });
    } catch (error) {
      console.error('Failed to create mention notification:', error);
    }

    return mentionResult;
  }

  async getMessageMentions(messageId: string) {
    return await db
      .select({
        id: mention.id,
        mentionedUser: {
          id: user.id,
          username: user.username,
          name: user.name,
          profilePictureURL: user.profilePictureURL,
        },
      })
      .from(mention)
      .innerJoin(user, eq(mention.mentionedUserId, user.id))
      .where(eq(mention.messageId, messageId));
  }

  async getUserMentions(userId: string, limit: number = 50) {
    return await db
      .select({
        id: mention.id,
        message: {
          id: roomMessage.id,
          content: roomMessage.content,
          createdAt: roomMessage.createdAt,
          roomId: roomMessage.roomId,
        },
        mentionedBy: {
          id: user.id,
          username: user.username,
          name: user.name,
          profilePictureURL: user.profilePictureURL,
        },
      })
      .from(mention)
      .innerJoin(roomMessage, eq(mention.messageId, roomMessage.id))
      .innerJoin(user, eq(roomMessage.userId, user.id))
      .where(eq(mention.mentionedUserId, userId))
      .orderBy(desc(roomMessage.createdAt))
      .limit(limit);
  }

  async deleteMention(mentionId: string): Promise<void> {
    await db.delete(mention).where(eq(mention.id, mentionId));
  }

  async deleteMessageMentions(messageId: string): Promise<void> {
    await db.delete(mention).where(eq(mention.messageId, messageId));
  }

  async findUsersByUsernames(
    usernames: string[],
  ): Promise<{ username: string; userId: string }[]> {
    if (usernames.length === 0) return [];

    const conditions = usernames.map((u) => eq(user.username, u));
    const results = await db
      .select({
        id: user.id,
        username: user.username,
      })
      .from(user)
      .where(or(...conditions));

    return results
      .filter((u): u is { id: string; username: string } => u.username != null)
      .map((u) => ({ username: u.username, userId: u.id }));
  }

  async findUserByUsername(
    username: string,
  ): Promise<{ id: string; username: string } | null> {
    const [result] = await db
      .select({
        id: user.id,
        username: user.username,
      })
      .from(user)
      .where(eq(user.username, username))
      .limit(1);

    if (!result || result.username == null) return null;
    return { id: result.id, username: result.username };
  }

  async getDisplayNameForSocket(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ username: user.username, name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!row) return null;
    return row.username ?? row.name ?? null;
  }
}
