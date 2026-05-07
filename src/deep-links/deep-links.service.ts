import { Injectable, Logger } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

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

  private readonly iosAppId =
    process.env.DEEP_LINK_IOS_APP_ID || 'TEAMID.com.edulearnv2.app';
  private readonly androidPackageName =
    process.env.DEEP_LINK_ANDROID_PACKAGE_NAME || 'com.edulearnv2.app';
  private readonly androidSha256Fingerprints = this.parseCsv(
    process.env.DEEP_LINK_ANDROID_SHA256_FINGERPRINTS ||
      '00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00',
  );

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

  buildReferralLandingPage(referralCode: string) {
    const sanitizedCode = this.normalizeUpperToken(referralCode);
    return this.buildLandingPage({
      linkType: 'referral',
      value: sanitizedCode,
      title: 'Join EduLearn with a referral',
      description:
        'Open EduLearn to sign up with this referral code and start learning.',
      canonicalPath: `/ref/${encodeURIComponent(sanitizedCode)}`,
    });
  }

  buildQuizLandingPage(quizId: string) {
    const sanitizedQuizId = this.normalizeToken(quizId);
    return this.buildLandingPage({
      linkType: 'publicQuiz',
      value: sanitizedQuizId,
      title: 'Open this EduLearn quiz',
      description:
        'Launch the EduLearn app to participate in this public quiz.',
      canonicalPath: `/quizzes/${encodeURIComponent(sanitizedQuizId)}`,
    });
  }

  buildCommunityLandingPage(inviteCode: string) {
    const sanitizedInviteCode = this.normalizeUpperToken(inviteCode);
    return this.buildLandingPage({
      linkType: 'communityInvite',
      value: sanitizedInviteCode,
      title: 'Join this EduLearn community',
      description: 'Open EduLearn to join this community invite.',
      canonicalPath: `/community/${encodeURIComponent(sanitizedInviteCode)}`,
    });
  }

  buildNotFoundPage() {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Link not found</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: #0b1020;
        color: #f8fafc;
        display: grid;
        place-items: center;
      }
      main {
        width: min(90vw, 420px);
        background: rgba(12, 15, 24, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        padding: 24px;
        text-align: center;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 24px;
      }
      p {
        margin: 0;
        color: #cbd5e1;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Link not found</h1>
      <p>This link is invalid or has expired.</p>
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

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
    <meta name="description" content="${escapedDescription}" />
    <meta property="og:title" content="${escapedTitle}" />
    <meta property="og:description" content="${escapedDescription}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapedCanonical}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapedTitle}" />
    <meta name="twitter:description" content="${escapedDescription}" />
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: radial-gradient(circle at top, #171923 0%, #090b10 60%, #05060a 100%);
        color: #f8fafc;
        display: grid;
        place-items: center;
      }
      main {
        width: min(90vw, 420px);
        background: rgba(12, 15, 24, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 18px;
        padding: 24px;
        text-align: center;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 24px;
        line-height: 1.2;
      }
      p {
        margin: 0 0 18px;
        color: #cbd5e1;
        line-height: 1.5;
      }
      a.button {
        display: inline-block;
        padding: 12px 16px;
        border-radius: 10px;
        text-decoration: none;
        font-weight: 600;
      }
      a.primary {
        background: #00ff80;
        color: #00150b;
      }
      a.secondary {
        background: rgba(255, 255, 255, 0.08);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.16);
        margin-top: 10px;
      }
      small {
        display: block;
        margin-top: 14px;
        color: #94a3b8;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapedTitle}</h1>
      <p>${escapedDescription}</p>
      <a id="open-app" class="button primary" href="${this.escapeHtml(
        deepLinkUrl,
      )}">Open App</a>
      <a id="install-app" class="button secondary" href="#">Install App</a>
      <small>If the app does not open automatically, use the buttons above.</small>
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

  private escapeHtml(input: string) {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
