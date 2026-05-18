import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminService } from './admin.service';
import { AdminApiKeyGuard } from '../auth/guards/admin-api-key.guard';
import type { NftListingBroadcastData } from '../emails/nft-listing-announcement.config';

@Throttle({ default: { limit: 80, ttl: 60_000 } })
@Controller('admin')
@UseGuards(AdminApiKeyGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('analytics/signups')
  async getSignupStats(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return await this.adminService.getSignupStats(start, end);
  }

  @Get('analytics/metrics')
  async getPlatformMetrics() {
    return await this.adminService.getPlatformMetrics();
  }

  @Get('analytics/activity-trends')
  async getActivityTrends(@Query('days') days?: string) {
    const daysNum = days ? parseInt(days, 10) : 30;
    return await this.adminService.getActivityTrends(daysNum);
  }

  @Get('analytics/engagement')
  async getEngagementMetrics() {
    return await this.adminService.getEngagementMetrics();
  }

  @Get('analytics/retention')
  async getRetentionMetrics() {
    return await this.adminService.getRetentionMetrics();
  }

  @Get('analytics/content')
  async getContentAnalytics() {
    return await this.adminService.getContentAnalytics();
  }

  @Get('analytics/revenue')
  async getRevenueMetrics() {
    return await this.adminService.getRevenueMetrics();
  }

  @Get('health')
  async getHealth() {
    return await this.adminService.getHealthStatus();
  }

  @Get('users')
  async getAllUsers() {
    return await this.adminService.getAllUsersForAdmin();
  }

  @Post('notifications/broadcast')
  async broadcastNotification(
    @Body() body: { title: string; content: string },
  ) {
    if (!body.title || !body.content) {
      throw new BadRequestException('Title and content are required');
    }
    return await this.adminService.broadcastNotification(
      body.title,
      body.content,
    );
  }

  @Get('feedback')
  async getFeedback() {
    return await this.adminService.getAllFeedback();
  }

  @Put('feedback/:id/status')
  async updateFeedbackStatus(
    @Param('id') id: string,
    @Body() body: { status: 'pending' | 'reviewed' | 'resolved' },
  ) {
    if (!body.status) {
      throw new BadRequestException('Status is required');
    }
    return await this.adminService.updateFeedbackStatus(
      id,
      body.status as 'pending' | 'reviewed' | 'resolved',
    );
  }

  @Post('notifications/send')
  async sendNotificationToUsers(
    @Body() body: { userIds: string[]; title: string; content: string },
  ) {
    if (!body.userIds || body.userIds.length === 0) {
      throw new BadRequestException('At least one user ID is required');
    }
    if (!body.title || !body.content) {
      throw new BadRequestException('Title and content are required');
    }
    return await this.adminService.sendNotificationToUsers(
      body.userIds,
      body.title,
      body.content,
    );
  }

  @Post('emails/broadcast')
  async broadcastEmail(@Body() body: { subject: string; htmlContent: string }) {
    if (!body.subject || !body.htmlContent) {
      throw new BadRequestException('Subject and HTML content are required');
    }
    return await this.adminService.broadcastEmail(
      body.subject,
      body.htmlContent,
    );
  }

  @Post('emails/send')
  async sendEmailToUsers(
    @Body() body: { emails: string[]; subject: string; htmlContent: string },
  ) {
    if (!body.emails || body.emails.length === 0) {
      throw new BadRequestException('At least one email address is required');
    }
    if (!body.subject || !body.htmlContent) {
      throw new BadRequestException('Subject and HTML content are required');
    }
    return await this.adminService.sendEmailToUsers(
      body.emails,
      body.subject,
      body.htmlContent,
    );
  }

  @Post('reminders/evaluate')
  async evaluateReminder(@Body() body: { userId: string }) {
    if (!body.userId?.trim()) {
      throw new BadRequestException('userId is required');
    }
    return await this.adminService.evaluateReminderNow(body.userId.trim());
  }

  @Post('reminders/preview')
  async previewReminder(@Body() body: { userId: string }) {
    if (!body.userId?.trim()) {
      throw new BadRequestException('userId is required');
    }
    return await this.adminService.previewReminder(body.userId.trim());
  }

  @Put('reminders/disable')
  async disableReminders(
    @Body() body: { userId: string; reason?: string },
  ) {
    if (!body.userId?.trim()) {
      throw new BadRequestException('userId is required');
    }
    return await this.adminService.setReminderDisabled(
      body.userId.trim(),
      true,
      body.reason,
    );
  }

  @Put('reminders/enable')
  async enableReminders(@Body() body: { userId: string }) {
    if (!body.userId?.trim()) {
      throw new BadRequestException('userId is required');
    }
    return await this.adminService.setReminderDisabled(body.userId.trim(), false);
  }

  @Post('agent-wakeup/preview')
  async previewAgentWakeup(@Body() body: { userId: string }) {
    if (!body.userId?.trim()) {
      throw new BadRequestException('userId is required');
    }
    return await this.adminService.previewAgentWakeup(body.userId.trim());
  }

  @Post('agent-wakeup/evaluate')
  async evaluateAgentWakeup(@Body() body: { userId: string }) {
    if (!body.userId?.trim()) {
      throw new BadRequestException('userId is required');
    }
    return await this.adminService.evaluateAgentWakeupNow(body.userId.trim());
  }

  @Post('emails/v25-announcement')
  async sendV25Announcement() {
    return await this.adminService.broadcastV25Announcement();
  }

  @Post('emails/v25-announcement/test')
  async sendV25AnnouncementTest(
    @Body() body: { email: string; name?: string },
  ) {
    if (!body.email?.trim()) {
      throw new BadRequestException('Email is required');
    }
    return await this.adminService.sendV25AnnouncementTest(
      body.email.trim(),
      body.name?.trim(),
    );
  }

  @Get('emails/preview/:template')
  async getEmailPreview(
    @Param('template') template: string,
    @Query('name') name?: string,
    @Query('referralCode') referralCode?: string,
    @Query('referralCount') referralCount?: string,
  ) {
    return await this.adminService.getEmailPreview(template, {
      name,
      referralCode,
      referralCount: referralCount ? parseInt(referralCount, 10) : undefined,
    });
  }

  @Post('emails/engagement/:template/test')
  async sendEngagementTest(
    @Param('template') template: string,
    @Body()
    body: {
      email: string;
      name?: string;
      referralCode?: string;
      referralCount?: number;
    },
  ) {
    if (!body.email?.trim()) {
      throw new BadRequestException('Email is required');
    }
    return await this.adminService.sendEngagementTest(
      template,
      body.email.trim(),
      {
        name: body.name,
        referralCode: body.referralCode,
        referralCount: body.referralCount,
      },
    );
  }

  @Post('emails/engagement/:template/broadcast')
  async broadcastEngagement(@Param('template') template: string) {
    return await this.adminService.broadcastEngagement(template);
  }

  @Get('emails/nft-listing/config')
  getNftListingBroadcastConfig() {
    return this.adminService.getNftListingBroadcastConfig();
  }

  @Post('emails/nft-listing/preview')
  async getNftListingAnnouncementPreview(
    @Body() body?: Partial<NftListingBroadcastData>,
  ) {
    return await this.adminService.getNftListingAnnouncementPreview(body);
  }

  @Post('emails/nft-listing/test')
  async sendNftListingAnnouncementTest(
    @Body() body: { email: string } & Partial<NftListingBroadcastData>,
  ) {
    if (!body.email?.trim()) {
      throw new BadRequestException('Email is required');
    }
    const { email, ...partial } = body;
    return await this.adminService.sendNftListingAnnouncementTest(
      email.trim(),
      partial,
    );
  }

  @Post('emails/nft-listing/broadcast')
  async broadcastNftListingAnnouncement(
    @Body() body?: Partial<NftListingBroadcastData>,
  ) {
    return await this.adminService.broadcastNftListingAnnouncement(body);
  }

  @Get('communities')
  async getAllCommunities() {
    return await this.adminService.getAllCommunities();
  }

  @Get('communities/:communityId')
  async getCommunityById(@Param('communityId') communityId: string) {
    const community =
      await this.adminService.getCommunityWithMembers(communityId);
    if (!community) {
      throw new NotFoundException(`Community with id ${communityId} not found`);
    }
    return community;
  }

  @Post('communities')
  async createCommunity(
    @Body()
    body: {
      title: string;
      inviteCode: string;
      visibility?: 'public' | 'private';
      imageUrl?: string;
      adminEmail: string;
    },
  ) {
    if (!body.title || !body.inviteCode) {
      throw new BadRequestException('Title and invite code are required');
    }
    if (!body.adminEmail) {
      throw new BadRequestException('Admin email/username is required');
    }
    try {
      return await this.adminService.createCommunityWithAdmin(body);
    } catch (error: any) {
      throw new BadRequestException(
        error.message || 'Failed to create community',
      );
    }
  }

  @Delete('communities/:communityId')
  async deleteCommunity(@Param('communityId') communityId: string) {
    return await this.adminService.deleteCommunity(communityId);
  }
}
