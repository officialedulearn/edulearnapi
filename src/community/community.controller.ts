import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  NotFoundException,
  ForbiddenException,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CommunityService } from './community.service';
import { RedisService } from '../redis/redis.service';
import { RealtimePublisherService } from '../realtime/realtime.publisher';
import { FlexibleAuthGuard } from '../auth/guards/flexible-auth.guard';
import { verifyUserAuthorization } from '../common/helpers/authorization.helper';
import { displayNameFromJwtClaims } from '../common/helpers/jwt-display.helper';

@Controller('community')
@UseGuards(FlexibleAuthGuard)
export class CommunityController {
  constructor(
    private readonly communityService: CommunityService,
    private readonly redisService: RedisService,
    private readonly realtimePublisher: RealtimePublisherService,
  ) {}

  @Post()
  async createCommunity(
    @Request() req,
    @Body()
    body: {
      title: string;
      inviteCode: string;
      visibility?: 'public' | 'private';
      imageUrl?: string;
    },
  ) {
    return await this.communityService.createCommunity(body);
  }

  @Get()
  async getPublicCommunities() {
    return await this.communityService.getPublicCommunities();
  }

  @Get('all')
  async getAllCommunities() {
    return await this.communityService.getAllCommunities();
  }

  @Get('invite/:inviteCode')
  async getCommunityByInviteCode(@Param('inviteCode') inviteCode: string) {
    const community =
      await this.communityService.getCommunityByInviteCode(inviteCode);
    if (!community) {
      throw new NotFoundException(
        `Community with invite code ${inviteCode} not found`,
      );
    }
    return community;
  }

  @Get(':communityId')
  async getCommunityById(@Param('communityId') communityId: string) {
    const community = await this.communityService.getCommunityById(communityId);
    if (!community) {
      throw new NotFoundException(`Community with id ${communityId} not found`);
    }
    return community;
  }

  @Put(':communityId')
  async updateCommunity(
    @Request() req,
    @Param('communityId') communityId: string,
    @Body()
    body: {
      title?: string;
      visibility?: 'public' | 'private';
      imageUrl?: string;
      inviteCode?: string;
    },
  ) {
    const role = await this.communityService.getMemberRole(
      req.user.sub,
      communityId,
    );
    if (role !== 'mod') {
      throw new ForbiddenException('Only moderators can update the community');
    }

    return await this.communityService.updateCommunity(communityId, body);
  }

  @Delete(':communityId')
  async deleteCommunity(
    @Request() req,
    @Param('communityId') communityId: string,
  ) {
    const role = await this.communityService.getMemberRole(
      req.user.sub,
      communityId,
    );
    if (role !== 'mod') {
      throw new ForbiddenException('Only moderators can delete the community');
    }

    await this.communityService.deleteCommunity(communityId);
    return { message: 'Community deleted successfully' };
  }
  @Post(':communityId/members')
  async addMember(
    @Request() req,
    @Param('communityId') communityId: string,
    @Body() body: { userId: string; role?: 'mod' | 'member' },
  ) {
    const role = await this.communityService.getMemberRole(
      req.user.sub,
      communityId,
    );
    if (role !== 'mod') {
      throw new ForbiddenException('Only moderators can add members');
    }

    return await this.communityService.addMemberToCommunity({
      userId: body.userId,
      communityId,
      role: body.role,
    });
  }

  @Get(':communityId/members')
  async getCommunityMembers(@Param('communityId') communityId: string) {
    return await this.communityService.getCommunityMembers(communityId);
  }

  @Get(':communityId/members/count')
  async getMemberCount(@Param('communityId') communityId: string) {
    const count =
      await this.communityService.getCommunityMemberCount(communityId);
    return { count };
  }

  @Get('user/:userId/communities')
  async getUserCommunities(@Request() req, @Param('userId') userId: string) {
    await verifyUserAuthorization(req.user, userId, 'viewing communities');
    return await this.communityService.getUserCommunities(userId);
  }

  @Get(':communityId/chat-bootstrap')
  async getCommunityChatBootstrap(
    @Request() req,
    @Param('communityId') communityId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('userId') userId?: string,
    @Query('membersLimit') membersLimit?: string,
  ) {
    const dbUserId = userId || req.user.sub;
    if (!dbUserId) {
      throw new ForbiddenException('User ID is required');
    }

    const role = await this.communityService.getMemberRole(
      dbUserId,
      communityId,
    );
    if (!role) {
      throw new ForbiddenException('You must be a member to view this chat');
    }

    let membersPreviewLimit = 250;
    if (membersLimit != null && membersLimit !== '') {
      const n = parseInt(membersLimit, 10);
      if (!Number.isNaN(n)) {
        membersPreviewLimit = Math.min(Math.max(n, 1), 500);
      }
    }

    const bootstrap = await this.communityService.getCommunityChatBootstrap(
      communityId,
      dbUserId,
      {
        messagesLimit: limit ? parseInt(limit) : 20,
        messagesOffset: offset ? parseInt(offset) : 0,
        viewerRole: role,
        membersPreviewLimit,
      },
    );

    if (!bootstrap) {
      throw new NotFoundException(`Community with id ${communityId} not found`);
    }

    return bootstrap;
  }

  @Get(':communityId/mod')
  async getCommunityMod(@Param('communityId') communityId: string) {
    return await this.communityService.getCommunityMod(communityId);
  }

  @Post(':communityId/update-mod')
  async updateCommunityModByXP(@Param('communityId') communityId: string) {
    await this.communityService.checkAndUpdateCommunityMod(communityId);
    return { message: 'Mod updated based on XP' };
  }

  @Put(':communityId/members/:userId/role')
  async updateMemberRole(
    @Request() req,
    @Param('communityId') communityId: string,
    @Param('userId') userId: string,
    @Body() body: { role: 'mod' | 'member' },
  ) {
    const role = await this.communityService.getMemberRole(
      req.user.sub,
      communityId,
    );
    if (role !== 'mod') {
      throw new ForbiddenException('Only moderators can update member roles');
    }

    return await this.communityService.updateMemberRole(
      userId,
      communityId,
      body.role,
    );
  }

  @Delete(':communityId/members/:userId')
  async removeMember(
    @Request() req,
    @Param('communityId') communityId: string,
    @Param('userId') userId: string,
  ) {
    const role = await this.communityService.getMemberRole(
      req.user.sub,
      communityId,
    );
    if (role !== 'mod' && req.user.sub !== userId) {
      throw new ForbiddenException('Only moderators can remove other members');
    }

    await this.communityService.removeMemberFromCommunity(userId, communityId);
    return { message: 'Member removed successfully' };
  }

  @Post(':communityId/join-requests')
  async createJoinRequest(
    @Request() req,
    @Param('communityId') communityId: string,
    @Body() body: { userId: string },
  ) {
    const userId = body.userId;
    if (!userId) {
      throw new ForbiddenException('User ID is required');
    }

    const isMember = await this.communityService.isUserMember(
      userId,
      communityId,
    );
    if (isMember) {
      throw new ForbiddenException(
        'You are already a member of this community',
      );
    }

    return await this.communityService.createJoinRequest({
      userId,
      communityId,
    });
  }

  @Get(':communityId/join-requests')
  async getPendingJoinRequests(
    @Request() req,
    @Param('communityId') communityId: string,
    @Query('userId') userId?: string,
  ) {
    const dbUserId = userId || req.user.sub;
    if (!dbUserId) {
      throw new ForbiddenException('User ID is required');
    }

    const role = await this.communityService.getMemberRole(
      dbUserId,
      communityId,
    );
    if (role !== 'mod') {
      throw new ForbiddenException('Only moderators can view join requests');
    }

    return await this.communityService.getPendingJoinRequests(communityId);
  }

  @Put('join-requests/:requestId')
  async updateJoinRequestStatus(
    @Request() req,
    @Param('requestId') requestId: string,
    @Body()
    body: {
      status: 'approved' | 'rejected';
      communityId: string;
      userId?: string;
    },
  ) {
    const dbUserId = body.userId || req.user.sub;
    if (!dbUserId) {
      throw new ForbiddenException('User ID is required');
    }

    const role = await this.communityService.getMemberRole(
      dbUserId,
      body.communityId,
    );
    if (role !== 'mod') {
      throw new ForbiddenException('Only moderators can update join requests');
    }

    const request = await this.communityService.updateJoinRequestStatus(
      requestId,
      body.status,
    );

    if (body.status === 'approved') {
      const joinRequest = await this.communityService.getUserJoinRequest(
        request.userId as string,
        body.communityId,
      );
      if (joinRequest) {
        await this.communityService.addMemberToCommunity({
          userId: request.userId as string,
          communityId: body.communityId,
        });
      }
    }

    return request;
  }

  @Delete('join-requests/:requestId')
  async deleteJoinRequest(
    @Request() req,
    @Param('requestId') requestId: string,
  ) {
    await this.communityService.deleteJoinRequest(requestId);
    return { message: 'Join request deleted successfully' };
  }

  @Post(':communityId/messages')
  async createMessage(
    @Request() req,
    @Param('communityId') communityId: string,
    @Body()
    body: { content: string; mentionedUserIds?: string[]; userId?: string },
  ) {
    const dbUserId = body.userId || req.user.sub;
    if (!dbUserId) {
      throw new ForbiddenException('User ID is required');
    }

    const isMember = await this.communityService.isUserMember(
      dbUserId,
      communityId,
    );
    if (!isMember) {
      throw new ForbiddenException('You must be a member to send messages');
    }

    const message = await this.communityService.createMessage({
      roomId: communityId,
      userId: dbUserId,
      content: body.content,
    });

    if (body.mentionedUserIds && body.mentionedUserIds.length > 0) {
      for (const mentionedUserId of body.mentionedUserIds) {
        await this.communityService.createMention({
          messageId: message.id,
          mentionedUserId,
          mentionedByUserId: dbUserId,
          communityId: communityId,
        });
      }
    }

    await this.redisService.clearTyping(communityId, dbUserId);

    const [fullMessage, modData] = await Promise.all([
      this.communityService.getMessageById(message.id),
      this.communityService.getCommunityMod(communityId).catch(() => null),
    ]);

    if (!fullMessage) {
      throw new NotFoundException('Message failed to persist');
    }

    const moderatorUserId = modData?.user.id ?? null;
    const messagePayload = {
      ...fullMessage,
      roomId: communityId,
      mentionedUserIds: body.mentionedUserIds,
      reactionCounts: {} as Record<string, number>,
      groupedReactionCounts: [] as { reaction: string; count: number }[],
      currentUserReaction: null as string | null,
      myReaction: null as string | null,
      isModeratorMessage:
        moderatorUserId !== null && fullMessage.user.id === moderatorUserId,
    };

    this.realtimePublisher.publishToCommunityRoom(
      communityId,
      'community.message.created',
      messagePayload,
    );

    return messagePayload;
  }

  @Post(':communityId/typing')
  async sendTyping(
    @Request() req,
    @Param('communityId') communityId: string,
    @Body() body: { isTyping: boolean; userId?: string },
  ) {
    const dbUserId = body.userId || req.user.sub;
    if (!dbUserId) {
      throw new ForbiddenException('User ID is required');
    }

    let canType = await this.redisService.isUserInRoom(communityId, dbUserId);
    if (!canType) {
      canType = await this.communityService.isUserMember(
        dbUserId,
        communityId,
      );
    }
    if (!canType) {
      throw new ForbiddenException('You must be a member to send typing state');
    }

    if (body.isTyping) {
      await this.redisService.setTyping(communityId, dbUserId, 6);
    } else {
      await this.redisService.clearTyping(communityId, dbUserId);
    }

    const username =
      displayNameFromJwtClaims(req.user as Record<string, unknown>) ?? 'User';

    this.realtimePublisher.publishToCommunityRoom(
      communityId,
      body.isTyping ? 'community.typing.started' : 'community.typing.stopped',
      {
        userId: dbUserId,
        username,
        communityId,
        timestamp: new Date().toISOString(),
      },
    );

    return { success: true };
  }

  @Get(':communityId/messages')
  async getRoomMessages(
    @Request() req,
    @Param('communityId') communityId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('userId') userId?: string,
  ) {
    const dbUserId = userId || req.user.sub;
    if (!dbUserId) {
      throw new ForbiddenException('User ID is required');
    }

    const isMember = await this.communityService.isUserMember(
      dbUserId,
      communityId,
    );
    if (!isMember) {
      throw new ForbiddenException('You must be a member to view messages');
    }

    return await this.communityService.getRoomMessages(
      communityId,
      limit ? parseInt(limit) : 20,
      offset ? parseInt(offset) : 0,
      dbUserId,
    );
  }

  @Get(':communityId/messages/count')
  async getMessageCount(@Param('communityId') communityId: string) {
    const count = await this.communityService.getRoomMessageCount(communityId);
    return { count };
  }

  @Get('messages/:messageId')
  async getMessageById(@Param('messageId') messageId: string) {
    const message = await this.communityService.getMessageById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    return message;
  }

  @Put('messages/:messageId')
  async updateMessage(
    @Request() req,
    @Param('messageId') messageId: string,
    @Body() body: { content: string },
  ) {
    const message = await this.communityService.getMessageById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.user.id !== req.user.sub) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    return await this.communityService.updateMessage(messageId, body.content);
  }

  @Delete('messages/:messageId')
  async deleteMessage(
    @Request() req,
    @Param('messageId') messageId: string,
    @Body() body?: { userId?: string },
  ) {
    const message = await this.communityService.getMessageById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    const dbUserId = body?.userId || req.user.sub;
    if (!dbUserId) {
      throw new ForbiddenException('User ID is required');
    }

    const role = await this.communityService.getMemberRole(
      dbUserId,
      message.roomId,
    );
    if (message.user.id !== dbUserId && role !== 'mod') {
      throw new ForbiddenException('You can only delete your own messages');
    }

    await this.communityService.deleteMessage(messageId);
    this.realtimePublisher.publishToCommunityRoom(
      message.roomId,
      'community.message.deleted',
      {
        messageId,
        communityId: message.roomId,
        deletedBy: dbUserId,
        timestamp: new Date().toISOString(),
      },
    );
    return { message: 'Message deleted successfully' };
  }

  @Post('messages/:messageId/reactions')
  async addReaction(
    @Request() req,
    @Param('messageId') messageId: string,
    @Body() body: { reaction: string; userId?: string; communityId?: string },
  ) {
    const dbUserId = body.userId || req.user.sub;
    if (!dbUserId) {
      throw new ForbiddenException('User ID is required');
    }

    const reaction = await this.communityService.addReaction({
      messageId,
      userId: dbUserId,
      reaction: body.reaction,
    });

    const message = await this.communityService.getMessageById(messageId);
    if (message) {
      const communityId = body.communityId ?? message.roomId;
      const reactionCounts =
        await this.communityService.getReactionCountByType(messageId);

      this.realtimePublisher.publishToCommunityRoom(
        communityId,
        'community.reaction.updated',
        {
          messageId,
          communityId,
          reaction: body.reaction,
          userId: dbUserId,
          username:
            (await this.communityService.getDisplayNameForSocket(dbUserId)) ??
            undefined,
          reactionCounts,
          timestamp: new Date().toISOString(),
        },
      );
    }

    return reaction;
  }

  @Get('messages/:messageId/reactions')
  async getMessageReactions(@Param('messageId') messageId: string) {
    return await this.communityService.getMessageReactions(messageId);
  }

  @Get('messages/:messageId/reactions/count')
  async getReactionCounts(@Param('messageId') messageId: string) {
    return await this.communityService.getReactionCountByType(messageId);
  }

  @Delete('messages/:messageId/reactions')
  async removeReaction(@Request() req, @Param('messageId') messageId: string) {
    const message = await this.communityService.getMessageById(messageId);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.communityService.removeReaction(messageId, req.user.sub);
    const reactionCounts =
      await this.communityService.getReactionCountByType(messageId);

    this.realtimePublisher.publishToCommunityRoom(
      message.roomId,
      'community.reaction.updated',
      {
        messageId,
        communityId: message.roomId,
        userId: req.user.sub,
        username:
          (await this.communityService.getDisplayNameForSocket(req.user.sub)) ??
          undefined,
        reactionCounts,
        timestamp: new Date().toISOString(),
      },
    );

    return { message: 'Reaction removed successfully' };
  }

  @Get('messages/:messageId/mentions')
  async getMessageMentions(@Param('messageId') messageId: string) {
    return await this.communityService.getMessageMentions(messageId);
  }

  @Get('user/:userId/mentions')
  async getUserMentions(
    @Request() req,
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    await verifyUserAuthorization(req.user, userId, 'viewing mentions');
    return await this.communityService.getUserMentions(
      userId,
      limit ? parseInt(limit) : 50,
    );
  }

  @Post('resolve-mentions')
  async resolveMentions(@Body() body: { usernames: string[] }) {
    if (!body.usernames || !Array.isArray(body.usernames)) {
      return [];
    }
    return await this.communityService.findUsersByUsernames(body.usernames);
  }
}
