jest.mock('../../drizzle', () => ({
  __esModule: true,
  default: {
    select: jest.fn(),
  },
}));

import { DeepLinksService } from './deep-links.service';
import db from '../../drizzle';

const makeSelectQuery = (result: unknown[]) => {
  const query: any = {};
  query.from = jest.fn(() => query);
  query.where = jest.fn(() => query);
  query.limit = jest.fn(() => Promise.resolve(result));
  return query;
};

describe('DeepLinksService', () => {
  let service: DeepLinksService;
  const selectMock = (db as any).select as jest.Mock;

  beforeEach(() => {
    selectMock.mockReset();
    service = new DeepLinksService();
    (
      service as unknown as { cacheManager: { get: jest.Mock; set: jest.Mock } }
    ).cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('builds apple app site association payload', () => {
    const payload = service.getAppleAppSiteAssociation();
    expect(payload.applinks.apps).toEqual([]);
    expect(payload.applinks.details[0].paths).toEqual(
      expect.arrayContaining(['/ref/*', '/quizzes/*', '/community/*']),
    );
  });

  it('builds assetlinks payload', () => {
    const payload = service.getAssetLinks();
    expect(payload[0]).toMatchObject({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: expect.any(String),
      },
    });
  });

  it('renders referral landing page html with og metadata', async () => {
    const html = await service.buildReferralLandingPage('abc123');
    expect(html).toContain('<meta property="og:title"');
    expect(html).toContain('class="brand-preview"');
    expect(html).toContain('edulearn-preview.png');
    expect(html).toContain('edulearnv2://ref/ABC123');
    expect(html).toContain('window.location.href = deepLinkUrl');
  });

  it('renders quiz landing page html with quiz-specific og metadata', async () => {
    selectMock.mockReturnValue(
      makeSelectQuery([
        {
          title: 'Solana Accounts',
          description: 'Account model practice',
          summary: 'Tests account ownership, lamports, and data layout.',
          coveredConcepts: ['accounts', 'ownership'],
          challengeProfile: 'Application',
        },
      ]),
    );

    const html = await service.buildQuizLandingPage(
      '123e4567-e89b-12d3-a456-426614174000',
    );

    expect(html).toContain('Try Solana Accounts');
    expect(html).toContain('Tests account ownership, lamports, and data layout.');
    expect(html).toContain('/quizzes/123e4567-e89b-12d3-a456-426614174000/og-image');
    expect(html).toContain('edulearnv2://quizzes/123e4567-e89b-12d3-a456-426614174000');
  });
});
