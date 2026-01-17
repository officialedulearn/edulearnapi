import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards, BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminApiKeyGuard } from '../auth/guards/admin-api-key.guard';

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
    return await this.adminService.broadcastNotification(body.title, body.content);
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
    return await this.adminService.sendNotificationToUsers(body.userIds, body.title, body.content);
  }

  @Post('emails/broadcast')
  async broadcastEmail(
    @Body() body: { subject: string; htmlContent: string },
  ) {
    if (!body.subject || !body.htmlContent) {
      throw new BadRequestException('Subject and HTML content are required');
    }
    return await this.adminService.broadcastEmail(body.subject, body.htmlContent);
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
    return await this.adminService.sendEmailToUsers(body.emails, body.subject, body.htmlContent);
  }

  @Get('communities')
  async getAllCommunities() {
    return await this.adminService.getAllCommunities();
  }

  @Get('communities/:communityId')
  async getCommunityById(@Param('communityId') communityId: string) {
    const community = await this.adminService.getCommunityWithMembers(communityId);
    if (!community) {
      throw new NotFoundException(`Community with id ${communityId} not found`);
    }
    return community;
  }

  @Post('communities')
  async createCommunity(
    @Body() body: { 
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
      throw new BadRequestException(error.message || 'Failed to create community');
    }
  }

  @Delete('communities/:communityId')
  async deleteCommunity(@Param('communityId') communityId: string) {
    return await this.adminService.deleteCommunity(communityId);
  }
}


