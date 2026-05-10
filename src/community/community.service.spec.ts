import { Test, TestingModule } from '@nestjs/testing';
import { CommunityService } from './community.service';
import { NotificationsService } from 'src/common/services/notifications.service';
import { AuthService } from 'src/auth/auth.service';

describe('CommunityService', () => {
  let service: CommunityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommunityService,
        { provide: NotificationsService, useValue: {} },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();

    service = module.get<CommunityService>(CommunityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
