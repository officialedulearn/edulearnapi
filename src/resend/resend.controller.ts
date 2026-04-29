import { Controller, Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ResendService } from './resend.service';

@Throttle({ default: { limit: 8, ttl: 60_000 } })
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
