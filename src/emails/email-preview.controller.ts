import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { render } from '@react-email/render';
import * as React from 'react';
import { V25AnnouncementEmail } from './templates/V25AnnouncementEmail';
import { ComeBackSoonEmail } from './templates/ComeBackSoonEmail';
import { ReferFriendsEmail } from './templates/ReferFriendsEmail';
import { StreakReminderEmail } from './templates/StreakReminderEmail';
import { EddyWeeklyTipEmail } from './templates/EddyWeeklyTipEmail';
import { ReferralSuperstarEmail } from './templates/ReferralSuperstarEmail';
import { NftListingAnnouncementEmail } from './templates/NftListingAnnouncementEmail';
import { mergeNftListingBroadcastData } from './nft-listing-announcement.config';

@Throttle({ default: { limit: 35, ttl: 60_000 } })
@Controller('emails/preview')
export class EmailPreviewController {
  @Get('v25-announcement')
  async previewV25Announcement(@Query('name') name?: string) {
    const html = await render(
      React.createElement(V25AnnouncementEmail, { name: name || 'Test User' }),
    );
    return html;
  }

  @Get('come-back-soon')
  async previewComeBackSoon(@Query('name') name?: string) {
    return render(
      React.createElement(ComeBackSoonEmail, { name: name || 'Test User' }),
    );
  }

  @Get('refer-friends')
  async previewReferFriends(
    @Query('name') name?: string,
    @Query('referralCode') referralCode?: string,
  ) {
    return render(
      React.createElement(ReferFriendsEmail, {
        name: name || 'Test User',
        referralCode: referralCode || 'ABC123',
      }),
    );
  }

  @Get('streak-reminder')
  async previewStreakReminder(@Query('name') name?: string) {
    return render(
      React.createElement(StreakReminderEmail, { name: name || 'Test User' }),
    );
  }

  @Get('eddy-tip')
  async previewEddyTip(@Query('name') name?: string) {
    return render(
      React.createElement(EddyWeeklyTipEmail, { name: name || 'Test User' }),
    );
  }

  @Get('nft-listing')
  async previewNftListing() {
    const data = mergeNftListingBroadcastData();
    return render(React.createElement(NftListingAnnouncementEmail, data));
  }

  @Get('referral-superstar')
  async previewReferralSuperstar(
    @Query('name') name?: string,
    @Query('referralCount') referralCount?: string,
    @Query('referralCode') referralCode?: string,
  ) {
    return render(
      React.createElement(ReferralSuperstarEmail, {
        name: name || 'Test User',
        referralCount: parseInt(referralCount || '5', 10),
        referralCode: referralCode || 'ABC123',
      }),
    );
  }
}
