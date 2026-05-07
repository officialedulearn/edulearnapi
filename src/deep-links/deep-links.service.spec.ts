import { DeepLinksService } from './deep-links.service';

describe('DeepLinksService', () => {
  let service: DeepLinksService;

  beforeEach(() => {
    service = new DeepLinksService();
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

  it('renders referral landing page html with og metadata', () => {
    const html = service.buildReferralLandingPage('abc123');
    expect(html).toContain('<meta property="og:title"');
    expect(html).toContain('edulearnv2://ref/ABC123');
    expect(html).toContain('window.location.href = deepLinkUrl');
  });
});
