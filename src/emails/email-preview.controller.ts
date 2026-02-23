import { Controller, Get, Query } from '@nestjs/common';
import { render } from '@react-email/render';
import * as React from 'react';
import { V25AnnouncementEmail } from './templates/V25AnnouncementEmail';

@Controller('emails/preview')
export class EmailPreviewController {
  @Get('v25-announcement')
  async previewV25Announcement(@Query('name') name?: string) {
    const html = await render(
      React.createElement(V25AnnouncementEmail, { name: name || 'Test User' })
    );
    return html;
  }
}
