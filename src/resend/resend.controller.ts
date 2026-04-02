import { Controller, Get } from '@nestjs/common';
import { ResendService } from './resend.service';

@Controller('resend')
export class ResendController {
  constructor(private readonly resendService: ResendService) {}

  @Get('add-users')
  async addUsersToContactList() {
    return await this.resendService.addAllUsersToResendContactList();
  }

  @Get('users-not-in-contacts')
  async getUsersNotInContacts() {
    return await this.resendService.getUsersNotInResendContacts();
  }
}
