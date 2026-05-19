import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
type LinkType = 'referral' | 'publicQuiz' | 'communityInvite';

type LandingPageInput = {
  linkType: LinkType;
  value: string;
  title: string;
  description: string;
  canonicalPath: string;
};

@Injectable()
export class DeepLinksService {
  private readonly logger = new Logger(DeepLinksService.name);

  private readonly deepLinkHost = (
    process.env.DEEP_LINK_HOST || 'mobile.edulearn.fun'
  ).toLowerCase();
  private readonly appScheme = process.env.DEEP_LINK_APP_SCHEME || 'edulearnv2';

  private readonly iosStoreUrl =
    process.env.DEEP_LINK_IOS_APP_STORE_URL ||
    'https://apps.apple.com/us/app/id0000000000';
  private readonly androidStoreUrl =
    process.env.DEEP_LINK_ANDROID_PLAY_STORE_URL ||
    'https://play.google.com/store/apps/details?id=com.edulearnv2.app';
  private readonly desktopFallbackUrl =
    process.env.DEEP_LINK_DESKTOP_FALLBACK_URL || 'https://edulearn.fun';

  private readonly brandName = process.env.DEEP_LINK_BRAND_NAME || 'EduLearn';
  private readonly brandMediaBase =
    process.env.DEEP_LINK_BRAND_MEDIA_BASE_URL ||
    'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media';
  private readonly brandSiteUrl = this.ensureAbsoluteUrl(
    process.env.DEEP_LINK_BRAND_SITE_URL || 'https://edulearn.fun',
  );
  private readonly brandSupportUrl = this.ensureAbsoluteUrl(
    process.env.DEEP_LINK_BRAND_SUPPORT_URL || 'https://support.edulearn.fun',
  );
  private readonly brandLogoUrl = this.resolveBrandAssetUrl(
    process.env.DEEP_LINK_BRAND_LOGO_URL,
    `${this.brandMediaBase}/logo.png`,
  );
  private readonly brandMarkUrl = this.resolveBrandAssetUrl(
    process.env.DEEP_LINK_BRAND_MARK_URL,
    `${this.brandMediaBase}/edulearn.png`,
  );
  private readonly brandFontUrl = this.resolveBrandAssetUrl(
    process.env.DEEP_LINK_BRAND_FONT_URL,
    `${this.brandSiteUrl}/assets/fonts/Satoshi-Regular.otf`,
  );
  private readonly brandPreviewImageUrl = this.resolveBrandAssetUrl(
    process.env.DEEP_LINK_BRAND_PREVIEW_IMAGE_URL,
    `${this.brandMediaBase}/edulearn-preview.png`,
  );

  private readonly iosAppId =
    process.env.DEEP_LINK_IOS_APP_ID || 'TEAMID.com.edulearnv2.app';
  private readonly androidPackageName =
    process.env.DEEP_LINK_ANDROID_PACKAGE_NAME || 'com.edulearnv2.app';
  private readonly androidSha256Fingerprints = this.parseCsv(
    process.env.DEEP_LINK_ANDROID_SHA256_FINGERPRINTS ||
      '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
  );
  @Inject(CACHE_MANAGER) private cacheManager: Cache;

  getAppleAppSiteAssociation() {
    return {
      applinks: {
        apps: [],
        details: [
          {
            appID: this.iosAppId,
            paths: ['/ref/*', '/quizzes/*', '/community/*'],
          },
        ],
      },
    };
  }

  getAssetLinks() {
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: this.androidPackageName,
          sha256_cert_fingerprints: this.androidSha256Fingerprints,
        },
      },
    ];
  }

  async buildReferralLandingPage(referralCode: string) {
    const cacheKey = `deep-links:referral:${referralCode}`;
    const cached = await this.cacheManager.get<string | null>(cacheKey);
    if (cached) {
      return cached;
    }
    const sanitizedCode = this.normalizeUpperToken(referralCode);
    const html = this.buildLandingPage({
      linkType: 'referral',
      value: sanitizedCode,
      title: 'Join EduLearn with a referral',
      description:
        'Open EduLearn to sign up with this referral code and start learning.',
      canonicalPath: `/ref/${encodeURIComponent(sanitizedCode)}`,
    });
    await this.cacheManager.set<string>(cacheKey, html, 60 * 60 * 24);
    return html;
  }

  async buildQuizLandingPage(quizId: string) {
    const cacheKey = `deep-links:quiz:${quizId}`;
    const cached = await this.cacheManager.get<string | null>(cacheKey);
    if (cached) {
      return cached;
    }
    const sanitizedQuizId = this.normalizeToken(quizId);
    const html = this.buildLandingPage({
      linkType: 'publicQuiz',
      value: sanitizedQuizId,
      title: 'Open this EduLearn quiz',
      description:
        'Launch the EduLearn app to participate in this public quiz.',
      canonicalPath: `/quizzes/${encodeURIComponent(sanitizedQuizId)}`,
    });
    await this.cacheManager.set<string>(cacheKey, html, 60 * 60 * 24);
    return html;
  }

  async buildCommunityLandingPage(inviteCode: string) {
    const cacheKey = `deep-links:community:${inviteCode}`;
    const cached = await this.cacheManager.get<string | null>(cacheKey);
    if (cached) {
      return cached;
    }
    const sanitizedInviteCode = this.normalizeUpperToken(inviteCode);
    const html = this.buildLandingPage({
      linkType: 'communityInvite',
      value: sanitizedInviteCode,
      title: 'Join this EduLearn community',
      description: 'Open EduLearn to join this community invite.',
      canonicalPath: `/community/${encodeURIComponent(sanitizedInviteCode)}`,
    });
    await this.cacheManager.set<string>(cacheKey, html, 60 * 60 * 24);
    return html;
  }

  buildNotFoundPage() {
    const escapedBrandName = this.escapeHtml(this.brandName);
    const escapedBrandSiteUrl = this.escapeHtml(this.brandSiteUrl);
    const escapedBrandSupportUrl = this.escapeHtml(this.brandSupportUrl);
    const escapedBrandLogoUrl = this.escapeHtml(this.brandLogoUrl);
    const escapedBrandMarkUrl = this.escapeHtml(this.brandMarkUrl);
    const escapedBrandFontUrl = this.escapeHtml(this.brandFontUrl);
    const escapedPreviewImageUrl = this.escapeHtml(this.brandPreviewImageUrl);

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedBrandName} | Link not found</title>
    <meta name="description" content="This ${escapedBrandName} link is invalid or has expired." />
    <meta name="theme-color" content="#00FF80" />
    <meta property="og:title" content="${escapedBrandName} | Link not found" />
    <meta property="og:description" content="This ${escapedBrandName} link is invalid or has expired." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapedBrandSiteUrl}" />
    <meta property="og:image" content="${escapedPreviewImageUrl}" />
    <meta property="og:site_name" content="${escapedBrandName}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedBrandName} | Link not found" />
    <meta name="twitter:description" content="This ${escapedBrandName} link is invalid or has expired." />
    <meta name="twitter:image" content="${escapedPreviewImageUrl}" />
    <style>
      @font-face {
        font-family: "Satoshi";
        src: url("${escapedBrandFontUrl}") format("opentype");
        font-style: normal;
        font-weight: 400;
        font-display: swap;
      }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Satoshi", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: radial-gradient(circle at 12% 15%, rgba(0, 255, 128, 0.22) 0%, rgba(0, 255, 128, 0) 40%), #0a0a0a;
        color: #e0e0e0;
        display: grid;
        place-items: center;
      }
      main {
        width: min(92vw, 460px);
        background: rgba(19, 19, 19, 0.95);
        border: 1px solid #2e3033;
        border-radius: 20px;
        padding: 28px 24px;
        text-align: center;
        box-shadow: 0 24px 50px rgba(0, 0, 0, 0.45);
      }
      .brand-preview {
        width: min(100%, 320px);
        height: auto;
        margin: 0 auto 18px;
        display: block;
        border-radius: 14px;
      }
      .brand-logo {
        width: min(160px, 55%);
        height: auto;
        margin: 0 auto 12px;
        display: block;
      }
      .brand-mark {
        width: 42px;
        height: 42px;
        margin: 0 auto 14px;
        opacity: 0.9;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 24px;
        line-height: 1.2;
      }
      p {
        margin: 0 0 18px;
        color: #b3b3b3;
        line-height: 1.5;
      }
      .actions {
        display: flex;
        gap: 10px;
        justify-content: center;
        flex-wrap: wrap;
      }
      a.button {
        display: inline-block;
        padding: 12px 16px;
        border-radius: 12px;
        text-decoration: none;
        font-weight: 700;
      }
      a.primary {
        background: #00ff80;
        color: #000000;
      }
      a.primary:hover {
        background: #00e070;
      }
      a.secondary {
        border: 1px solid #2e3033;
        color: #00ff80;
        background: rgba(0, 255, 128, 0.06);
      }
      small {
        display: block;
        margin-top: 12px;
        color: #8a8a8a;
      }
    </style>
  </head>
  <body>
    <main>
      <img class="brand-preview" src="${escapedPreviewImageUrl}" alt="${escapedBrandName} preview" loading="eager" />
      <img class="brand-logo" src="${escapedBrandLogoUrl}" alt="${escapedBrandName} logo" loading="eager" />
      <img class="brand-mark" src="${escapedBrandMarkUrl}" alt="" aria-hidden="true" />
      <h1>Link not found</h1>
      <p>This link is invalid or has expired.</p>
      <div class="actions">
        <a class="button primary" href="${escapedBrandSiteUrl}">Go to ${escapedBrandName}</a>
        <a class="button secondary" href="${escapedBrandSupportUrl}">Get support</a>
      </div>
      <small>Check the link and try again.</small>
    </main>
  </body>
</html>`;
  }

  logHit(request: FastifyRequest, linkType: LinkType, value: string) {
    const payload = {
      type: linkType,
      value,
      host: request.hostname,
      path: request.url,
      userAgent: request.headers['user-agent'] ?? null,
      referer: request.headers.referer ?? null,
      timestamp: new Date().toISOString(),
    };
    this.logger.log(`deep_link_hit ${JSON.stringify(payload)}`);
  }

  private buildLandingPage(input: LandingPageInput) {
    const { linkType, value, title, description, canonicalPath } = input;

    const deepLinkUrl = this.getDeepLinkUrl(linkType, value);
    const deepLinkUrlJson = JSON.stringify(deepLinkUrl);
    const iosStoreUrlJson = JSON.stringify(this.iosStoreUrl);
    const androidStoreUrlJson = JSON.stringify(this.androidStoreUrl);
    const desktopFallbackUrlJson = JSON.stringify(this.desktopFallbackUrl);

    const escapedTitle = this.escapeHtml(title);
    const escapedDescription = this.escapeHtml(description);
    const escapedCanonical = this.escapeHtml(
      `https://${this.deepLinkHost}${canonicalPath}`,
    );
    const escapedBrandName = this.escapeHtml(this.brandName);
    const escapedBrandLogoUrl = this.escapeHtml(this.brandLogoUrl);
    const escapedBrandMarkUrl = this.escapeHtml(this.brandMarkUrl);
    const escapedBrandFontUrl = this.escapeHtml(this.brandFontUrl);
    const escapedPreviewImageUrl = this.escapeHtml(this.brandPreviewImageUrl);
    const escapedBrandSiteUrl = this.escapeHtml(this.brandSiteUrl);

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <meta name="description" content="${escapedDescription}" />
    <meta name="theme-color" content="#00FF80" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapedCanonical}" />
    <meta property="og:image" content="${escapedPreviewImageUrl}" />
    <meta property="og:site_name" content="${escapedBrandName}" />
    <meta property="og:image:alt" content="${escapedBrandName} preview" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    <meta name="twitter:image" content="${escapedPreviewImageUrl}" />
    <link rel="canonical" href="${escapedCanonical}" />
    <style>
      @font-face {
        font-family: "Satoshi";
        src: url("${escapedBrandFontUrl}") format("opentype");
        font-style: normal;
        font-weight: 400;
        font-display: swap;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Satoshi", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: radial-gradient(circle at 10% 10%, rgba(0, 255, 128, 0.24) 0%, rgba(0, 255, 128, 0) 35%), #0a0a0a;
        color: #e0e0e0;
        display: grid;
        place-items: center;
      }
      main {
        width: min(92vw, 460px);
        background: rgba(19, 19, 19, 0.95);
        border: 1px solid #2e3033;
        border-radius: 20px;
        padding: 28px 24px;
        text-align: center;
        box-shadow: 0 24px 50px rgba(0, 0, 0, 0.45);
      }
      .brand-preview {
        width: min(100%, 320px);
        height: auto;
        margin: 0 auto 16px;
        display: block;
        border-radius: 14px;
      }
      .brand-logo {
        width: min(160px, 55%);
        height: auto;
        margin: 0 auto 12px;
        display: block;
      }
      .brand-mark {
        width: 36px;
        height: 36px;
        margin: 0 auto 14px;
        opacity: 0.95;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 26px;
        line-height: 1.2;
      }
      p {
        margin: 0 0 18px;
        color: #b3b3b3;
        line-height: 1.5;
      }
      .actions {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }
      a.button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: min(100%, 300px);
        padding: 12px 16px;
        border-radius: 12px;
        text-decoration: none;
        font-weight: 700;
      }
      a.primary {
        background: #00ff80;
        color: #000000;
      }
      a.primary:hover {
        background: #00e070;
      }
      a.secondary {
        background: rgba(0, 255, 128, 0.06);
        color: #00ff80;
        border: 1px solid #2e3033;
      }
      small {
        display: block;
        margin-top: 14px;
        color: #8a8a8a;
      }
      .footer-link {
        margin-top: 12px;
        color: #8a8a8a;
        font-size: 13px;
      }
      .footer-link a {
        color: #00ff80;
        text-decoration: none;
      }
      .footer-link a:hover {
        text-decoration: underline;
      }
    </style>
  </head>
  <body>
    <main>
      <img class="brand-preview" src="${escapedPreviewImageUrl}" alt="${escapedBrandName} preview" loading="eager" />
      <img class="brand-logo" src="${escapedBrandLogoUrl}" alt="${escapedBrandName} logo" loading="eager" />
      <img class="brand-mark" src="${escapedBrandMarkUrl}" alt="" aria-hidden="true" />
      <h1>${escapedTitle}</h1>
      <p>${escapedDescription}</p>
      <div class="actions">
        <a id="open-app" class="button primary" href="${this.escapeHtml(
          deepLinkUrl,
        )}">Open ${escapedBrandName}</a>
        <a id="install-app" class="button secondary" href="#">Install ${escapedBrandName}</a>
      </div>
      <small>If the app does not open automatically, use the buttons above.</small>
      <div class="footer-link">Need help? <a href="${escapedBrandSiteUrl}">Visit ${escapedBrandName}</a></div>
    </main>
    <script>
      (function () {
        const deepLinkUrl = ${deepLinkUrlJson};
        const iosStoreUrl = ${iosStoreUrlJson};
        const androidStoreUrl = ${androidStoreUrlJson};
        const desktopFallbackUrl = ${desktopFallbackUrlJson};
        const ua = navigator.userAgent || "";
        const isAndroid = /Android/i.test(ua);
        const isIOS = /iPhone|iPad|iPod/i.test(ua);
        const installTarget = isAndroid ? androidStoreUrl : isIOS ? iosStoreUrl : desktopFallbackUrl;
        const installButton = document.getElementById("install-app");
        if (installButton) {
          installButton.setAttribute("href", installTarget);
        }

        setTimeout(function () {
          window.location.href = installTarget;
        }, 1800);

        window.location.href = deepLinkUrl;
      })();
    </script>
  </body>
</html>`;
  }

  private getDeepLinkUrl(linkType: LinkType, value: string) {
    if (linkType === 'referral') {
      return `${this.appScheme}://ref/${encodeURIComponent(value)}`;
    }
    if (linkType === 'communityInvite') {
      return `${this.appScheme}://community/${encodeURIComponent(value)}`;
    }
    return `${this.appScheme}://quizzes/${encodeURIComponent(value)}`;
  }

  private normalizeToken(value: string) {
    return value.trim();
  }

  private normalizeUpperToken(value: string) {
    return value.trim().toUpperCase();
  }

  private parseCsv(value: string) {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private resolveBrandAssetUrl(envValue: string | undefined, fallback: string) {
    const value = envValue?.trim();
    return this.ensureAbsoluteUrl(value && value.length > 0 ? value : fallback);
  }

  private ensureAbsoluteUrl(value: string) {
    const normalized = value.trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(normalized)) {
      return normalized;
    }
    return `https://${normalized.replace(/^\/+/, '')}`;
  }

  private escapeHtml(input: string) {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
