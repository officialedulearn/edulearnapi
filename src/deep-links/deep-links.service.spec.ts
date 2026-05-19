import { DeepLinksService } from './deep-links.service';

describe('DeepLinksService', () => {
  let service: DeepLinksService;

  beforeEach(() => {
    service = new DeepLinksService();
    (service as unknown as { cacheManager: { get: jest.Mock; set: jest.Mock } }).cacheManager =
      {
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
});
