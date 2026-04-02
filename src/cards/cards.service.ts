import { Injectable, OnModuleInit } from '@nestjs/common';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import axios from 'axios';
import db from '../../drizzle';
import { user, roadmap, roadMapStep } from '../../lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { decompress } from 'wawoff2';

interface RoadmapProgress {
  completed: number;
  total: number;
}

@Injectable()
export class CardsService implements OnModuleInit {
  private regular?: Buffer;
  private bold?: Buffer;
  private imageCache: Map<string, string> = new Map();
  private isWarmedUp = false;

  private readonly mascotUrls = {
    streak:
      'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/streak.png',
    earnings:
      'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/Celebrate.png',
    level:
      'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/proud.png',
    profile:
      'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/proud.png',
    nftMint:
      'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/proud.png',
    roadmap:
      'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/proud.png',
  };

  private readonly eduLearnLogoUrl =
    'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/logo.png';

  async onModuleInit() {
    this.warmUpCache();
  }

  private async warmUpCache() {
    if (this.isWarmedUp) return;
    try {
      console.log('Warming up image cache...');
      await Promise.all([
        this.toDataUrl(this.eduLearnLogoUrl),
        this.toDataUrl(this.mascotUrls.streak),
        this.toDataUrl(this.mascotUrls.earnings),
        this.toDataUrl(this.mascotUrls.level),
        this.toDataUrl(this.mascotUrls.profile),
        this.toDataUrl(this.mascotUrls.nftMint),
        this.toDataUrl(this.mascotUrls.roadmap),
      ]);
      this.isWarmedUp = true;
      console.log('Image cache warmed up successfully');
    } catch (error) {
      console.error('Failed to warm up cache:', error);
    }
  }

  private getHighQualityImageUrl(
    url: string | null | undefined,
  ): string | undefined {
    if (!url || typeof url !== 'string') return undefined;
    return url
      .replace(/_normal(\.[a-z]+)$/i, '_400x400$1')
      .replace(/_mini(\.[a-z]+)$/i, '_400x400$1')
      .replace(/_bigger(\.[a-z]+)$/i, '_400x400$1');
  }

  private async loadFonts() {
    if (this.regular && this.bold) return;

    try {
      const regularPath = path.join(
        process.cwd(),
        'public/fonts/Satoshi-Regular.otf',
      );
      const boldPath = path.join(
        process.cwd(),
        'public/fonts/Satoshi-Bold.otf',
      );

      this.regular = fs.readFileSync(regularPath);
      this.bold = fs.readFileSync(boldPath);
      console.log('Loaded Satoshi fonts successfully');
    } catch (satoshiError) {
      console.error('Satoshi fonts not found, trying Urbanist...');
      try {
        const regularPath = path.join(
          process.cwd(),
          'node_modules/@fontsource/urbanist/files/urbanist-latin-400-normal.woff2',
        );
        const boldPath = path.join(
          process.cwd(),
          'node_modules/@fontsource/urbanist/files/urbanist-latin-900-normal.woff2',
        );

        const regularWoff2 = fs.readFileSync(regularPath);
        const boldWoff2 = fs.readFileSync(boldPath);

        this.regular = Buffer.from(await decompress(regularWoff2));
        this.bold = Buffer.from(await decompress(boldWoff2));
        console.log('Loaded Urbanist fonts as fallback');
      } catch (urbanistError) {
        console.error('Urbanist not found, falling back to Inter');
        const regularPath = path.join(
          process.cwd(),
          'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2',
        );
        const boldPath = path.join(
          process.cwd(),
          'node_modules/@fontsource/inter/files/inter-latin-900-normal.woff2',
        );

        const regularWoff2 = fs.readFileSync(regularPath);
        const boldWoff2 = fs.readFileSync(boldPath);

        this.regular = Buffer.from(await decompress(regularWoff2));
        this.bold = Buffer.from(await decompress(boldWoff2));
        console.log('Loaded Inter fonts as final fallback');
      }
    }
  }

  private getTheme(theme: 'light' | 'dark') {
    if (theme === 'dark') {
      return {
        background: '#0a0a0a',
        card: '#212121',
        foreground: '#FFFFFF',
        mutedForeground: '#B3B3B3',
        border: 'rgba(255,255,255,0.1)',
        ring: '#2E3033',
        success: '#00FF80',
        primary: '#00FF80',
        primaryForeground: '#000000',
        secondary: '#131313',
      };
    }
    return {
      background: '#FFFFFF',
      card: '#FFFFFF',
      foreground: '#0a0a0a',
      mutedForeground: '#61728C',
      border: '#EDF3FC',
      ring: '#EDF3FC',
      success: '#00FF80',
      primary: '#00FF80',
      primaryForeground: '#000000',
      secondary: '#F5F5F5',
    };
  }

  private async toDataUrl(url?: string): Promise<string | undefined> {
    if (!url) return undefined;

    if (this.imageCache.has(url)) {
      return this.imageCache.get(url);
    }

    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        maxRedirects: 2,
      });
      const mime = res.headers['content-type'] || 'image/png';
      const base64 = Buffer.from(res.data).toString('base64');
      const dataUrl = `data:${mime};base64,${base64}`;

      this.imageCache.set(url, dataUrl);

      if (this.imageCache.size > 100) {
        const firstKey = this.imageCache.keys().next().value;
        this.imageCache.delete(firstKey);
      }

      return dataUrl;
    } catch (error) {
      console.error(`Failed to fetch image from ${url}:`, error.message);
      return undefined;
    }
  }

  async generateOg(params?: {
    title?: string;
    subtitle?: string;
    mascotUrl?: string;
    theme?: 'light' | 'dark';
  }): Promise<Buffer> {
    await this.loadFonts();
    const theme = this.getTheme(params?.theme ?? 'light');
    const mascotDataUrl = await this.toDataUrl(params?.mascotUrl);
    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: '1200px',
            height: '630px',
            background: theme.background,
            display: 'flex',
            flexDirection: 'row',
            gap: '40px',
            padding: '50px',
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  flex: 1,
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '12px',
                        background: theme.card,
                        color: theme.foreground,
                        borderRadius: '10px',
                        border: `1px solid ${theme.border}`,
                        padding: '10px 14px',
                        marginBottom: '18px',
                        fontFamily: 'Inter',
                        fontSize: 18,
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            style: {
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              background: theme.success,
                            },
                          },
                        },
                        {
                          type: 'span',
                          props: { children: 'EduLearn' },
                        },
                      ],
                    },
                  },
                  {
                    type: 'h1',
                    props: {
                      children: params?.title ?? 'Testing Satori',
                      style: {
                        fontFamily: 'Inter',
                        fontSize: 60,
                        fontWeight: 700,
                        lineHeight: 1.1,
                        margin: 0,
                        color: theme.foreground,
                      },
                    },
                  },
                  {
                    type: 'p',
                    props: {
                      children:
                        params?.subtitle ?? 'AI-powered learning platform',
                      style: {
                        fontFamily: 'Inter',
                        fontSize: 24,
                        marginTop: 16,
                        color: theme.mutedForeground,
                      },
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  width: '430px',
                  height: '430px',
                  borderRadius: '24px',
                  background: theme.card,
                  border: `1px solid ${theme.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                },
                children: mascotDataUrl
                  ? [
                      {
                        type: 'img',
                        props: {
                          src: mascotDataUrl,
                          style: {
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                          },
                        },
                      },
                    ]
                  : [
                      {
                        type: 'div',
                        props: {
                          style: {
                            width: '80%',
                            height: '80%',
                            border: `2px dashed ${theme.ring}`,
                            borderRadius: '16px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: theme.mutedForeground,
                            fontFamily: 'Inter',
                            fontSize: 20,
                          },
                          children: 'Mascot area',
                        },
                      },
                    ],
              },
            },
          ],
        },
      } as any,
      {
        width: 1080,
        height: 1080,
        fonts: [
          { name: 'Satoshi', data: this.regular!, weight: 400 },
          { name: 'Satoshi', data: this.bold!, weight: 700 },
        ],
      },
    );

    const png = new Resvg(svg).render().asPng();
    return Buffer.from(png);
  }

  async generateStreakCard(params: {
    userId: string;
    theme?: 'light' | 'dark';
  }): Promise<Buffer> {
    const startTime = Date.now();
    console.log(`[StreakCard] Starting generation for user ${params.userId}`);

    const [userData] = await Promise.all([
      db.select().from(user).where(eq(user.id, params.userId)).limit(1),
      this.loadFonts(),
    ]);
    console.log(
      `[StreakCard] DB + Fonts loaded in ${Date.now() - startTime}ms`,
    );

    if (!userData[0]) throw new Error('User not found');

    const u = userData[0];
    const theme = this.getTheme(params?.theme ?? 'dark');
    const highQualityAvatar = this.getHighQualityImageUrl(u.profilePictureURL);

    const imageStartTime = Date.now();
    const [avatarDataUrl, mascotDataUrl, logoDataUrl] = await Promise.all([
      this.toDataUrl(highQualityAvatar),
      this.toDataUrl(this.mascotUrls.streak),
      this.toDataUrl(this.eduLearnLogoUrl),
    ]);
    console.log(
      `[StreakCard] Images loaded in ${Date.now() - imageStartTime}ms`,
    );

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: '1080px',
            height: '1080px',
            background: theme.background,
            display: 'flex',
            flexDirection: 'column',
            padding: '60px',
            position: 'relative',
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '50px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                      },
                      children: [
                        logoDataUrl && {
                          type: 'img',
                          props: {
                            src: logoDataUrl,
                            style: {
                              width: '100px',
                              height: '100px',
                              objectFit: 'contain',
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flex: 1,
                  padding: '0 40px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '24px',
                        flex: 1,
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: '20px',
                              marginBottom: '20px',
                            },
                            children: [
                              avatarDataUrl
                                ? {
                                    type: 'img',
                                    props: {
                                      src: avatarDataUrl,
                                      style: {
                                        width: '80px',
                                        height: '80px',
                                        borderRadius: '50%',
                                        border: `4px solid ${theme.success}`,
                                        objectFit: 'cover',
                                      },
                                    },
                                  }
                                : {
                                    type: 'div',
                                    props: {
                                      style: {
                                        width: '80px',
                                        height: '80px',
                                        borderRadius: '50%',
                                        background: theme.card,
                                        border: `4px solid ${theme.success}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 40,
                                      },
                                      children: '👤',
                                    },
                                  },
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    display: 'flex',
                                    flexDirection: 'column',
                                  },
                                  children: [
                                    {
                                      type: 'div',
                                      props: {
                                        children: u.name,
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 32,
                                          fontWeight: 700,
                                          color: theme.foreground,
                                        },
                                      },
                                    },
                                    {
                                      type: 'div',
                                      props: {
                                        children: `@${u.username}`,
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 20,
                                          color: theme.mutedForeground,
                                          marginTop: 4,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px',
                            },
                            children: [
                              {
                                type: 'p',
                                props: {
                                  children: "I'm on a",
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 40,
                                    margin: 0,
                                    color: theme.foreground,
                                    fontWeight: 700,
                                  },
                                },
                              },
                              {
                                type: 'h1',
                                props: {
                                  children: u.streak.toString(),
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 200,
                                    fontWeight: 900,
                                    margin: 0,
                                    color: theme.foreground,
                                    lineHeight: 0.85,
                                    letterSpacing: '-10px',
                                  },
                                },
                              },
                              {
                                type: 'p',
                                props: {
                                  children: 'day learning streak!',
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 40,
                                    margin: 0,
                                    color: theme.foreground,
                                    fontWeight: 900,
                                    lineHeight: 1.2,
                                  },
                                },
                              },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              gap: '16px',
                              marginTop: '30px',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    background: theme.card,
                                    border: `3px solid ${theme.success}`,
                                    borderRadius: '16px',
                                    padding: '20px 28px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                  },
                                  children: [
                                    {
                                      type: 'div',
                                      props: {
                                        children: u.xp.toString(),
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 44,
                                          fontWeight: 900,
                                          color: theme.success,
                                        },
                                      },
                                    },
                                    {
                                      type: 'div',
                                      props: {
                                        children: 'XP',
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 18,
                                          color: theme.mutedForeground,
                                          marginTop: 6,
                                          fontWeight: 700,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    background: theme.card,
                                    border: `3px solid ${theme.success}`,
                                    borderRadius: '16px',
                                    padding: '20px 28px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                  },
                                  children: [
                                    {
                                      type: 'div',
                                      props: {
                                        children: u.quizCompleted.toString(),
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 44,
                                          fontWeight: 900,
                                          color: theme.success,
                                        },
                                      },
                                    },
                                    {
                                      type: 'div',
                                      props: {
                                        children: 'Quizzes',
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 18,
                                          color: theme.mutedForeground,
                                          marginTop: 6,
                                          fontWeight: 700,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  mascotDataUrl
                    ? {
                        type: 'img',
                        props: {
                          src: mascotDataUrl,
                          style: {
                            width: '420px',
                            height: '420px',
                            objectFit: 'contain',
                            marginRight: '-40px',
                          },
                        },
                      }
                    : {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: 400,
                            lineHeight: 1,
                          },
                          children: '🔥',
                        },
                      },
                ],
              },
            },
          ],
        },
      } as any,
      {
        width: 1080,
        height: 1080,
        fonts: [
          { name: 'Satoshi', data: this.regular!, weight: 400 },
          { name: 'Satoshi', data: this.bold!, weight: 700 },
        ],
      },
    );
    console.log(`[StreakCard] SVG generated in ${Date.now() - startTime}ms`);

    const renderStartTime = Date.now();
    const png = new Resvg(svg).render().asPng();
    console.log(
      `[StreakCard] PNG rendered in ${Date.now() - renderStartTime}ms`,
    );
    console.log(`[StreakCard] Total time: ${Date.now() - startTime}ms`);
    return Buffer.from(png);
  }

  async generateEarningsCard(params: {
    userId: string;
    theme?: 'light' | 'dark';
  }): Promise<Buffer> {
    await this.loadFonts();

    const userData = await db
      .select()
      .from(user)
      .where(eq(user.id, params.userId))
      .limit(1);
    if (!userData[0]) throw new Error('User not found');

    const u = userData[0];
    const theme = this.getTheme(params?.theme ?? 'dark');
    const highQualityAvatar = this.getHighQualityImageUrl(u.profilePictureURL);
    const avatarDataUrl = await this.toDataUrl(highQualityAvatar);
    const mascotDataUrl = await this.toDataUrl(this.mascotUrls.earnings);
    const logoDataUrl = await this.toDataUrl(this.eduLearnLogoUrl);
    const earnings = parseFloat(u.totalEarnings || '0');
    const credits = parseFloat(u.credits || '0');

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: '1080px',
            height: '1080px',
            background: theme.background,
            display: 'flex',
            flexDirection: 'column',
            padding: '60px',
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '50px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                      },
                      children: [
                        logoDataUrl && {
                          type: 'img',
                          props: {
                            src: logoDataUrl,
                            style: {
                              width: '150px',
                              height: '150px',
                              objectFit: 'contain',
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flex: 1,
                  padding: '0 40px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '32px',
                        flex: 1,
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: '20px',
                              marginBottom: '20px',
                            },
                            children: [
                              avatarDataUrl
                                ? {
                                    type: 'img',
                                    props: {
                                      src: avatarDataUrl,
                                      style: {
                                        width: '80px',
                                        height: '80px',
                                        borderRadius: '50%',
                                        border: `4px solid ${theme.success}`,
                                        objectFit: 'cover',
                                      },
                                    },
                                  }
                                : {
                                    type: 'div',
                                    props: {
                                      style: {
                                        width: '80px',
                                        height: '80px',
                                        borderRadius: '50%',
                                        background: theme.card,
                                        border: `4px solid ${theme.success}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 40,
                                      },
                                      children: '👤',
                                    },
                                  },
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    display: 'flex',
                                    flexDirection: 'column',
                                  },
                                  children: [
                                    {
                                      type: 'div',
                                      props: {
                                        children: u.name,
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 32,
                                          fontWeight: 700,
                                          color: theme.foreground,
                                        },
                                      },
                                    },
                                    {
                                      type: 'div',
                                      props: {
                                        children: `@${u.username}`,
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 20,
                                          color: theme.mutedForeground,
                                          marginTop: 4,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '16px',
                            },
                            children: [
                              {
                                type: 'p',
                                props: {
                                  children: 'Total Earned',
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 36,
                                    margin: 0,
                                    color: theme.mutedForeground,
                                    fontWeight: 700,
                                  },
                                },
                              },
                              {
                                type: 'h1',
                                props: {
                                  children: `$${earnings.toFixed(2)}`,
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 160,
                                    fontWeight: 900,
                                    margin: 0,
                                    color: theme.success,
                                    lineHeight: 0.9,
                                    letterSpacing: '-6px',
                                  },
                                },
                              },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              gap: '16px',
                              marginTop: '30px',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    background: theme.card,
                                    border: `3px solid ${theme.success}`,
                                    borderRadius: '16px',
                                    padding: '20px 28px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                  },
                                  children: [
                                    {
                                      type: 'div',
                                      props: {
                                        children: (
                                          u.referralCount || 0
                                        ).toString(),
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 44,
                                          fontWeight: 900,
                                          color: theme.success,
                                        },
                                      },
                                    },
                                    {
                                      type: 'div',
                                      props: {
                                        children: 'Referrals',
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 18,
                                          color: theme.mutedForeground,
                                          marginTop: 6,
                                          fontWeight: 700,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    background: theme.card,
                                    border: `3px solid ${theme.success}`,
                                    borderRadius: '16px',
                                    padding: '20px 28px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                  },
                                  children: [
                                    {
                                      type: 'div',
                                      props: {
                                        children: u.xp.toString(),
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 44,
                                          fontWeight: 900,
                                          color: theme.success,
                                        },
                                      },
                                    },
                                    {
                                      type: 'div',
                                      props: {
                                        children: 'Total XP',
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 18,
                                          color: theme.mutedForeground,
                                          marginTop: 6,
                                          fontWeight: 700,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  mascotDataUrl
                    ? {
                        type: 'img',
                        props: {
                          src: mascotDataUrl,
                          style: {
                            width: '400px',
                            height: '400px',
                            objectFit: 'contain',
                            marginRight: '-40px',
                          },
                        },
                      }
                    : {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: 380,
                            lineHeight: 1,
                          },
                          children: '💰',
                        },
                      },
                ],
              },
            },
          ],
        },
      } as any,
      {
        width: 1080,
        height: 1080,
        fonts: [
          { name: 'Satoshi', data: this.regular!, weight: 400 },
          { name: 'Satoshi', data: this.bold!, weight: 700 },
        ],
      },
    );

    const png = new Resvg(svg).render().asPng();
    return Buffer.from(png);
  }

  async generateLevelCard(params: {
    userId: string;
    theme?: 'light' | 'dark';
  }): Promise<Buffer> {
    await this.loadFonts();

    const userData = await db
      .select()
      .from(user)
      .where(eq(user.id, params.userId))
      .limit(1);
    if (!userData[0]) throw new Error('User not found');

    const u = userData[0];
    const theme = this.getTheme(params?.theme ?? 'dark');
    const highQualityAvatar = this.getHighQualityImageUrl(u.profilePictureURL);
    const avatarDataUrl = await this.toDataUrl(highQualityAvatar);
    const mascotDataUrl = await this.toDataUrl(this.mascotUrls.level);
    const logoDataUrl = await this.toDataUrl(this.eduLearnLogoUrl);

    const levelEmojis: Record<string, string> = {
      novice: '🌱',
      beginner: '📚',
      intermediate: '🎯',
      advanced: '🚀',
      expert: '👑',
    };

    const levelNames: Record<string, string> = {
      novice: 'Novice',
      beginner: 'Beginner',
      intermediate: 'Intermediate',
      advanced: 'Advanced',
      expert: 'Expert',
    };

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: '1080px',
            height: '1080px',
            background: theme.background,
            display: 'flex',
            flexDirection: 'column',
            padding: '60px',
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '50px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                      },
                      children: [
                        logoDataUrl && {
                          type: 'img',
                          props: {
                            src: logoDataUrl,
                            style: {
                              width: '50px',
                              height: '50px',
                              objectFit: 'contain',
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  gap: '40px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '24px',
                      },
                      children: [
                        avatarDataUrl
                          ? {
                              type: 'img',
                              props: {
                                src: avatarDataUrl,
                                style: {
                                  width: '200px',
                                  height: '200px',
                                  borderRadius: '50%',
                                  border: `5px solid ${theme.success}`,
                                  objectFit: 'cover',
                                },
                              },
                            }
                          : {
                              type: 'div',
                              props: {
                                style: {
                                  width: '200px',
                                  height: '200px',
                                  borderRadius: '50%',
                                  background: theme.card,
                                  border: `5px solid ${theme.success}`,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 100,
                                },
                                children: '👤',
                              },
                            },
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  children: u.name,
                                  style: {
                                    fontFamily: 'Inter',
                                    fontSize: 40,
                                    fontWeight: 700,
                                    color: theme.foreground,
                                  },
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: `@${u.username}`,
                                  style: {
                                    fontFamily: 'Inter',
                                    fontSize: 24,
                                    color: theme.mutedForeground,
                                    marginTop: 8,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: {
                        background: theme.card,
                        border: `3px solid ${theme.success}`,
                        borderRadius: '24px',
                        padding: '40px 80px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '32px',
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            style: {
                              fontSize: 100,
                            },
                            children: levelEmojis[u.level] || '🌱',
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  children: levelNames[u.level] || 'Novice',
                                  style: {
                                    fontFamily: 'Inter',
                                    fontSize: 64,
                                    fontWeight: 700,
                                    color: theme.success,
                                    lineHeight: 1,
                                  },
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: 'Level',
                                  style: {
                                    fontFamily: 'Inter',
                                    fontSize: 28,
                                    color: theme.mutedForeground,
                                    marginTop: 12,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        gap: '32px',
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  children: u.xp.toString(),
                                  style: {
                                    fontFamily: 'Inter',
                                    fontSize: 48,
                                    fontWeight: 700,
                                    color: theme.foreground,
                                  },
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: 'XP',
                                  style: {
                                    fontFamily: 'Inter',
                                    fontSize: 20,
                                    color: theme.mutedForeground,
                                    marginTop: 4,
                                  },
                                },
                              },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              width: '2px',
                              background: theme.border,
                            },
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  children: u.quizCompleted.toString(),
                                  style: {
                                    fontFamily: 'Inter',
                                    fontSize: 48,
                                    fontWeight: 700,
                                    color: theme.foreground,
                                  },
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: 'Quizzes',
                                  style: {
                                    fontFamily: 'Inter',
                                    fontSize: 20,
                                    color: theme.mutedForeground,
                                    marginTop: 4,
                                  },
                                },
                              },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              width: '2px',
                              background: theme.border,
                            },
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  children: `${u.streak}🔥`,
                                  style: {
                                    fontFamily: 'Inter',
                                    fontSize: 48,
                                    fontWeight: 700,
                                    color: theme.foreground,
                                  },
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: 'Streak',
                                  style: {
                                    fontFamily: 'Inter',
                                    fontSize: 20,
                                    color: theme.mutedForeground,
                                    marginTop: 4,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      } as any,
      {
        width: 1080,
        height: 1080,
        fonts: [
          { name: 'Satoshi', data: this.regular!, weight: 400 },
          { name: 'Satoshi', data: this.bold!, weight: 700 },
        ],
      },
    );

    const png = new Resvg(svg).render().asPng();
    return Buffer.from(png);
  }

  async generateProfileSummaryCard(params: {
    userId: string;
    theme?: 'light' | 'dark';
  }): Promise<Buffer> {
    const startTime = Date.now();
    console.log(
      `[ProfileSummaryCard] Starting generation for user ${params.userId}`,
    );

    const [userData] = await Promise.all([
      db.select().from(user).where(eq(user.id, params.userId)).limit(1),
      this.loadFonts(),
    ]);
    console.log(
      `[ProfileSummaryCard] DB + Fonts loaded in ${Date.now() - startTime}ms`,
    );

    if (!userData[0]) throw new Error('User not found');

    const u = userData[0];
    const theme = this.getTheme(params?.theme ?? 'dark');
    const highQualityAvatar = this.getHighQualityImageUrl(u.profilePictureURL);

    const imageStartTime = Date.now();
    const [avatarDataUrl, mascotDataUrl, logoDataUrl] = await Promise.all([
      this.toDataUrl(highQualityAvatar),
      this.toDataUrl(this.mascotUrls.profile),
      this.toDataUrl(this.eduLearnLogoUrl),
    ]);
    console.log(
      `[ProfileSummaryCard] Images loaded in ${Date.now() - imageStartTime}ms`,
    );

    const levelEmojis: Record<string, string> = {
      novice: '🌱',
      beginner: '📚',
      intermediate: '🎯',
      advanced: '🚀',
      expert: '👑',
    };

    const levelNames: Record<string, string> = {
      novice: 'Novice',
      beginner: 'Beginner',
      intermediate: 'Intermediate',
      advanced: 'Advanced',
      expert: 'Expert',
    };

    const earnings = parseFloat(u.totalEarnings || '0');

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: '1080px',
            height: '1080px',
            background: theme.background,
            display: 'flex',
            flexDirection: 'column',
            padding: '60px',
            position: 'relative',
          },
          children: [
            // Header with logo
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '40px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                      },
                      children: [
                        logoDataUrl && {
                          type: 'img',
                          props: {
                            src: logoDataUrl,
                            style: {
                              width: '80px',
                              height: '80px',
                              objectFit: 'contain',
                            },
                          },
                        },
                      ],
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      style: {
                        background: theme.success,
                        color: theme.primaryForeground,
                        padding: '12px 24px',
                        borderRadius: '50px',
                        fontFamily: 'Satoshi',
                        fontSize: 20,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      },
                      children: [
                        {
                          type: 'span',
                          props: {
                            children: levelEmojis[u.level] || '🌱',
                            style: { fontSize: 24 },
                          },
                        },
                        {
                          type: 'span',
                          props: {
                            children: levelNames[u.level] || 'Novice',
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            // Profile section with avatar and name
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '32px',
                  marginBottom: '40px',
                  padding: '32px',
                  background: theme.card,
                  borderRadius: '24px',
                  border: `2px solid ${theme.border}`,
                },
                children: [
                  avatarDataUrl
                    ? {
                        type: 'img',
                        props: {
                          src: avatarDataUrl,
                          style: {
                            width: '140px',
                            height: '140px',
                            borderRadius: '50%',
                            border: `5px solid ${theme.success}`,
                            objectFit: 'cover',
                          },
                        },
                      }
                    : {
                        type: 'div',
                        props: {
                          style: {
                            width: '140px',
                            height: '140px',
                            borderRadius: '50%',
                            background: theme.secondary,
                            border: `5px solid ${theme.success}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 70,
                          },
                          children: '👤',
                        },
                      },
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        flex: 1,
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            children: u.name,
                            style: {
                              fontFamily: 'Satoshi',
                              fontSize: 48,
                              fontWeight: 700,
                              color: theme.foreground,
                            },
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            children: `@${u.username}`,
                            style: {
                              fontFamily: 'Satoshi',
                              fontSize: 28,
                              color: theme.mutedForeground,
                            },
                          },
                        },
                      ],
                    },
                  },
                  mascotDataUrl
                    ? {
                        type: 'img',
                        props: {
                          src: mascotDataUrl,
                          style: {
                            width: '160px',
                            height: '160px',
                            objectFit: 'contain',
                          },
                        },
                      }
                    : null,
                ],
              },
            },
            // Stats grid
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px',
                  flex: 1,
                },
                children: [
                  // Row 1 - XP and Streak
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        gap: '20px',
                      },
                      children: [
                        // XP Card
                        {
                          type: 'div',
                          props: {
                            style: {
                              flex: 1,
                              background: theme.card,
                              border: `3px solid ${theme.success}`,
                              borderRadius: '24px',
                              padding: '32px',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    marginBottom: '16px',
                                  },
                                  children: [
                                    {
                                      type: 'span',
                                      props: {
                                        children: '⚡',
                                        style: { fontSize: 40 },
                                      },
                                    },
                                    {
                                      type: 'span',
                                      props: {
                                        children: 'Total XP',
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 24,
                                          color: theme.mutedForeground,
                                          fontWeight: 600,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: u.xp.toLocaleString(),
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 72,
                                    fontWeight: 900,
                                    color: theme.success,
                                    lineHeight: 1,
                                  },
                                },
                              },
                            ],
                          },
                        },
                        // Streak Card
                        {
                          type: 'div',
                          props: {
                            style: {
                              flex: 1,
                              background: theme.card,
                              border: `3px solid ${theme.success}`,
                              borderRadius: '24px',
                              padding: '32px',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    marginBottom: '16px',
                                  },
                                  children: [
                                    {
                                      type: 'span',
                                      props: {
                                        children: '🔥',
                                        style: { fontSize: 40 },
                                      },
                                    },
                                    {
                                      type: 'span',
                                      props: {
                                        children: 'Day Streak',
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 24,
                                          color: theme.mutedForeground,
                                          fontWeight: 600,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: u.streak.toString(),
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 72,
                                    fontWeight: 900,
                                    color: theme.success,
                                    lineHeight: 1,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  // Row 2 - Quizzes and Referrals
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        gap: '20px',
                      },
                      children: [
                        // Quizzes Card
                        {
                          type: 'div',
                          props: {
                            style: {
                              flex: 1,
                              background: theme.card,
                              border: `3px solid ${theme.success}`,
                              borderRadius: '24px',
                              padding: '32px',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    marginBottom: '16px',
                                  },
                                  children: [
                                    {
                                      type: 'span',
                                      props: {
                                        children: '🧠',
                                        style: { fontSize: 40 },
                                      },
                                    },
                                    {
                                      type: 'span',
                                      props: {
                                        children: 'Quizzes',
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 24,
                                          color: theme.mutedForeground,
                                          fontWeight: 600,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: u.quizCompleted.toString(),
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 72,
                                    fontWeight: 900,
                                    color: theme.success,
                                    lineHeight: 1,
                                  },
                                },
                              },
                            ],
                          },
                        },
                        // Referrals Card
                        {
                          type: 'div',
                          props: {
                            style: {
                              flex: 1,
                              background: theme.card,
                              border: `3px solid ${theme.success}`,
                              borderRadius: '24px',
                              padding: '32px',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '12px',
                                    marginBottom: '16px',
                                  },
                                  children: [
                                    {
                                      type: 'span',
                                      props: {
                                        children: '👥',
                                        style: { fontSize: 40 },
                                      },
                                    },
                                    {
                                      type: 'span',
                                      props: {
                                        children: 'Referrals',
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 24,
                                          color: theme.mutedForeground,
                                          fontWeight: 600,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: (u.referralCount || 0).toString(),
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 72,
                                    fontWeight: 900,
                                    color: theme.success,
                                    lineHeight: 1,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  // Row 3 - Total Earnings (full width)
                  {
                    type: 'div',
                    props: {
                      style: {
                        background: theme.success,
                        borderRadius: '24px',
                        padding: '32px 48px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: '16px',
                            },
                            children: [
                              {
                                type: 'span',
                                props: {
                                  children: '💰',
                                  style: { fontSize: 48 },
                                },
                              },
                              {
                                type: 'span',
                                props: {
                                  children: 'Total Earned',
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 32,
                                    color: theme.primaryForeground,
                                    fontWeight: 700,
                                  },
                                },
                              },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            children: `$${earnings.toFixed(2)}`,
                            style: {
                              fontFamily: 'Satoshi',
                              fontSize: 64,
                              fontWeight: 900,
                              color: theme.primaryForeground,
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      } as any,
      {
        width: 1080,
        height: 1080,
        fonts: [
          { name: 'Satoshi', data: this.regular!, weight: 400 },
          { name: 'Satoshi', data: this.bold!, weight: 700 },
        ],
      },
    );

    console.log(
      `[ProfileSummaryCard] SVG generated in ${Date.now() - startTime}ms`,
    );

    const renderStartTime = Date.now();
    const png = new Resvg(svg).render().asPng();
    console.log(
      `[ProfileSummaryCard] PNG rendered in ${Date.now() - renderStartTime}ms`,
    );
    console.log(`[ProfileSummaryCard] Total time: ${Date.now() - startTime}ms`);
    return Buffer.from(png);
  }

  async generateNFTMintCard(params: {
    userId: string;
    nftImageUrl?: string;
    nftTitle?: string;
    theme?: 'light' | 'dark';
  }): Promise<Buffer> {
    const startTime = Date.now();
    console.log(`[NFTMintCard] Starting generation for user ${params.userId}`);

    const [userData] = await Promise.all([
      db.select().from(user).where(eq(user.id, params.userId)).limit(1),
      this.loadFonts(),
    ]);
    console.log(
      `[NFTMintCard] DB + Fonts loaded in ${Date.now() - startTime}ms`,
    );

    if (!userData[0]) throw new Error('User not found');

    const u = userData[0];
    const theme = this.getTheme(params?.theme ?? 'dark');
    const highQualityAvatar = this.getHighQualityImageUrl(u.profilePictureURL);

    const imageStartTime = Date.now();
    const [avatarDataUrl, mascotDataUrl, logoDataUrl, nftDataUrl] =
      await Promise.all([
        this.toDataUrl(highQualityAvatar),
        this.toDataUrl(this.mascotUrls.profile),
        this.toDataUrl(this.eduLearnLogoUrl),
        this.toDataUrl(params.nftImageUrl),
      ]);
    console.log(
      `[NFTMintCard] Images loaded in ${Date.now() - imageStartTime}ms`,
    );

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: '1080px',
            height: '1080px',
            background: theme.background,
            display: 'flex',
            flexDirection: 'column',
            padding: '60px',
            position: 'relative',
          },
          children: [
            // Header with logo
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '50px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                      },
                      children: [
                        logoDataUrl && {
                          type: 'img',
                          props: {
                            src: logoDataUrl,
                            style: {
                              width: '100px',
                              height: '100px',
                              objectFit: 'contain',
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            // Main content area
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  gap: '40px',
                },
                children: [
                  // User info section
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '20px',
                        marginBottom: '10px',
                      },
                      children: [
                        avatarDataUrl
                          ? {
                              type: 'img',
                              props: {
                                src: avatarDataUrl,
                                style: {
                                  width: '80px',
                                  height: '80px',
                                  borderRadius: '50%',
                                  border: `4px solid ${theme.success}`,
                                  objectFit: 'cover',
                                },
                              },
                            }
                          : {
                              type: 'div',
                              props: {
                                style: {
                                  width: '80px',
                                  height: '80px',
                                  borderRadius: '50%',
                                  background: theme.card,
                                  border: `4px solid ${theme.success}`,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 40,
                                },
                                children: '👤',
                              },
                            },
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  children: u.name,
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 32,
                                    fontWeight: 700,
                                    color: theme.foreground,
                                  },
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: `@${u.username}`,
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 20,
                                    color: theme.mutedForeground,
                                    marginTop: 4,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  // Main message
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '16px',
                        textAlign: 'center',
                      },
                      children: [
                        {
                          type: 'h1',
                          props: {
                            children: 'Just Claimed a Badge! 🎉',
                            style: {
                              fontFamily: 'Satoshi',
                              fontSize: 56,
                              fontWeight: 900,
                              margin: 0,
                              color: theme.foreground,
                              lineHeight: 1.2,
                            },
                          },
                        },
                        params.nftTitle && {
                          type: 'p',
                          props: {
                            children: params.nftTitle,
                            style: {
                              fontFamily: 'Satoshi',
                              fontSize: 28,
                              margin: 0,
                              color: theme.success,
                              fontWeight: 700,
                            },
                          },
                        },
                      ],
                    },
                  },
                  // NFT Display with Mascot
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '30px',
                      },
                      children: [
                        // NFT Card
                        {
                          type: 'div',
                          props: {
                            style: {
                              width: '320px',
                              height: '320px',
                              borderRadius: '24px',
                              background: theme.card,
                              border: `4px solid ${theme.success}`,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              overflow: 'hidden',
                              boxShadow: `0 10px 40px rgba(0, 255, 128, 0.3)`,
                            },
                            children: nftDataUrl
                              ? [
                                  {
                                    type: 'img',
                                    props: {
                                      src: nftDataUrl,
                                      style: {
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                      },
                                    },
                                  },
                                ]
                              : [
                                  {
                                    type: 'div',
                                    props: {
                                      style: {
                                        fontSize: 140,
                                        lineHeight: 1,
                                      },
                                      children: '🎨',
                                    },
                                  },
                                ],
                          },
                        },
                        // Proud Mascot
                        mascotDataUrl && {
                          type: 'img',
                          props: {
                            src: mascotDataUrl,
                            style: {
                              width: '320px',
                              height: '320px',
                              objectFit: 'contain',
                            },
                          },
                        },
                      ],
                    },
                  },
                  // Stats section
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        gap: '16px',
                        marginTop: '20px',
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            style: {
                              background: theme.card,
                              border: `3px solid ${theme.success}`,
                              borderRadius: '16px',
                              padding: '20px 32px',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  children: u.xp.toString(),
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 44,
                                    fontWeight: 900,
                                    color: theme.success,
                                  },
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: 'Total XP',
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 16,
                                    color: theme.mutedForeground,
                                    marginTop: 6,
                                    fontWeight: 700,
                                  },
                                },
                              },
                            ],
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            style: {
                              background: theme.success,
                              borderRadius: '16px',
                              padding: '20px 32px',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  children: '🏆',
                                  style: {
                                    fontSize: 44,
                                  },
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: 'Badge Claimed',
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 16,
                                    color: theme.primaryForeground,
                                    marginTop: 6,
                                    fontWeight: 700,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      } as any,
      {
        width: 1080,
        height: 1080,
        fonts: [
          { name: 'Satoshi', data: this.regular!, weight: 400 },
          { name: 'Satoshi', data: this.bold!, weight: 700 },
        ],
      },
    );
    console.log(`[NFTMintCard] SVG generated in ${Date.now() - startTime}ms`);

    const renderStartTime = Date.now();
    const png = new Resvg(svg).render().asPng();
    console.log(
      `[NFTMintCard] PNG rendered in ${Date.now() - renderStartTime}ms`,
    );
    console.log(`[NFTMintCard] Total time: ${Date.now() - startTime}ms`);
    return Buffer.from(png);
  }

  async generateRoadmapProgressCard(params: {
    roadmapId: string;
    theme?: 'light' | 'dark';
  }): Promise<Buffer> {
    const startTime = Date.now();
    console.log(
      `[RoadmapProgressCard] Starting generation for roadmap ${params.roadmapId}`,
    );

    const [roadmapData] = await db
      .select()
      .from(roadmap)
      .where(eq(roadmap.id, params.roadmapId))
      .limit(1);
    if (!roadmapData) throw new Error('Roadmap not found');

    const steps = await db
      .select()
      .from(roadMapStep)
      .where(eq(roadMapStep.roadmapId, params.roadmapId))
      .orderBy(asc(roadMapStep.createdAt));

    const totalSteps = steps.length;
    const completedSteps = steps.filter((step) => step.done === true).length;

    const [userData] = await Promise.all([
      db.select().from(user).where(eq(user.id, roadmapData.userId)).limit(1),
      this.loadFonts(),
    ]);
    console.log(
      `[RoadmapProgressCard] DB + Fonts loaded in ${Date.now() - startTime}ms`,
    );

    if (!userData[0]) throw new Error('User not found');

    const u = userData[0];
    const theme = this.getTheme(params?.theme ?? 'dark');
    const highQualityAvatar = this.getHighQualityImageUrl(u.profilePictureURL);

    const imageStartTime = Date.now();
    const [avatarDataUrl, mascotDataUrl, logoDataUrl] = await Promise.all([
      this.toDataUrl(highQualityAvatar),
      this.toDataUrl(this.mascotUrls.roadmap),
      this.toDataUrl(this.eduLearnLogoUrl),
    ]);
    console.log(
      `[RoadmapProgressCard] Images loaded in ${Date.now() - imageStartTime}ms`,
    );

    const progressPercentage = Math.round((completedSteps / totalSteps) * 100);

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: '1080px',
            height: '1080px',
            background: theme.background,
            display: 'flex',
            flexDirection: 'column',
            padding: '60px',
            position: 'relative',
          },
          children: [
            // Header with logo
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '50px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                      },
                      children: [
                        ...(logoDataUrl
                          ? [
                              {
                                type: 'img',
                                props: {
                                  src: logoDataUrl,
                                  style: {
                                    width: '100px',
                                    height: '100px',
                                    objectFit: 'contain',
                                  },
                                },
                              },
                            ]
                          : []),
                      ],
                    },
                  },
                ],
              },
            },
            // Main content area
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flex: 1,
                  padding: '0 40px',
                },
                children: [
                  // Left side content
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '32px',
                        flex: 1,
                      },
                      children: [
                        // User info section
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: '20px',
                              marginBottom: '10px',
                            },
                            children: [
                              avatarDataUrl
                                ? {
                                    type: 'img',
                                    props: {
                                      src: avatarDataUrl,
                                      style: {
                                        width: '80px',
                                        height: '80px',
                                        borderRadius: '50%',
                                        border: `4px solid ${theme.success}`,
                                        objectFit: 'cover',
                                      },
                                    },
                                  }
                                : {
                                    type: 'div',
                                    props: {
                                      style: {
                                        width: '80px',
                                        height: '80px',
                                        borderRadius: '50%',
                                        background: theme.success,
                                        border: `4px solid ${theme.success}`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 32,
                                        fontFamily: 'Satoshi',
                                        fontWeight: 700,
                                        color: '#ffffff',
                                      },
                                      children:
                                        u.name?.charAt(0)?.toUpperCase() || 'U',
                                    },
                                  },
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    display: 'flex',
                                    flexDirection: 'column',
                                  },
                                  children: [
                                    {
                                      type: 'div',
                                      props: {
                                        children: u.name,
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 32,
                                          fontWeight: 700,
                                          color: theme.foreground,
                                        },
                                      },
                                    },
                                    {
                                      type: 'div',
                                      props: {
                                        children: `@${u.username}`,
                                        style: {
                                          fontFamily: 'Satoshi',
                                          fontSize: 20,
                                          color: theme.mutedForeground,
                                          marginTop: 4,
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                        // Progress message
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '16px',
                            },
                            children: [
                              {
                                type: 'p',
                                props: {
                                  children: 'Learning Progress',
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 24,
                                    margin: 0,
                                    color: theme.mutedForeground,
                                    fontWeight: 500,
                                  },
                                },
                              },
                              {
                                type: 'h1',
                                props: {
                                  children: `${completedSteps}/${totalSteps}`,
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 120,
                                    fontWeight: 900,
                                    margin: 0,
                                    color: theme.success,
                                    lineHeight: 1,
                                    letterSpacing: '-4px',
                                  },
                                },
                              },
                              {
                                type: 'p',
                                props: {
                                  children: 'steps completed',
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 32,
                                    margin: 0,
                                    color: theme.foreground,
                                    fontWeight: 700,
                                    lineHeight: 1.2,
                                  },
                                },
                              },
                            ],
                          },
                        },
                        // Roadmap title card
                        {
                          type: 'div',
                          props: {
                            style: {
                              background: theme.card,
                              border: `3px solid ${theme.border}`,
                              borderRadius: '20px',
                              padding: '24px 28px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '12px',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  children: 'Roadmap',
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 18,
                                    color: theme.mutedForeground,
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: '2px',
                                  },
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: roadmapData.title,
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 28,
                                    fontWeight: 700,
                                    color: theme.foreground,
                                    lineHeight: 1.3,
                                  },
                                },
                              },
                              // Progress bar
                              {
                                type: 'div',
                                props: {
                                  style: {
                                    width: '100%',
                                    height: '12px',
                                    background: theme.ring,
                                    borderRadius: '6px',
                                    overflow: 'hidden',
                                    marginTop: '8px',
                                    display: 'flex',
                                  },
                                  children: [
                                    {
                                      type: 'div',
                                      props: {
                                        style: {
                                          width: `${progressPercentage}%`,
                                          height: '100%',
                                          background: theme.success,
                                          borderRadius: '6px',
                                        },
                                      },
                                    },
                                  ],
                                },
                              },
                              {
                                type: 'div',
                                props: {
                                  children: `${progressPercentage}% Complete`,
                                  style: {
                                    fontFamily: 'Satoshi',
                                    fontSize: 20,
                                    fontWeight: 700,
                                    color: theme.success,
                                    marginTop: 4,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  // Mascot on the right
                  ...(mascotDataUrl
                    ? [
                        {
                          type: 'img',
                          props: {
                            src: mascotDataUrl,
                            style: {
                              width: '380px',
                              height: '380px',
                              objectFit: 'contain',
                              marginRight: '-20px',
                            },
                          },
                        },
                      ]
                    : []),
                ],
              },
            },
          ],
        },
      } as any,
      {
        width: 1080,
        height: 1080,
        fonts: [
          { name: 'Satoshi', data: this.regular!, weight: 400 },
          { name: 'Satoshi', data: this.bold!, weight: 700 },
        ],
      },
    );
    console.log(
      `[RoadmapProgressCard] SVG generated in ${Date.now() - startTime}ms`,
    );

    const renderStartTime = Date.now();
    const png = new Resvg(svg).render().asPng();
    console.log(
      `[RoadmapProgressCard] PNG rendered in ${Date.now() - renderStartTime}ms`,
    );
    console.log(
      `[RoadmapProgressCard] Total time: ${Date.now() - startTime}ms`,
    );
    return Buffer.from(png);
  }

  async generateMonthlyLeaderboardCard(params: {
    monthLabel: string;
    theme?: 'light' | 'dark';
    variant?: 'monthly' | 'daily';
    entries: Array<{
      rank: 1 | 2 | 3;
      username: string;
      name: string;
      xp: number;
      avatarUrl?: string | null;
    }>;
  }): Promise<Buffer> {
    await this.loadFonts();
    const theme = this.getTheme(params?.theme ?? 'dark');
    const variant = params.variant ?? 'monthly';
    const titleUpper =
      variant === 'daily' ? 'Daily leaderboard' : 'Monthly leaderboard';
    const emptyBlurb =
      variant === 'daily'
        ? 'No ranked users yet. Start learning on edulearn.fun!'
        : 'No weekly XP was recorded for this month yet. Keep learning!';
    const bodyBlurb =
      variant === 'daily'
        ? 'Top learners by all-time XP on the platform right now.'
        : 'Top learners by XP earned across weekly periods in this month.';
    const xpPillLabel = variant === 'daily' ? 'XP' : 'XP (month)';
    const [logoDataUrl, mascotDataUrl] = await Promise.all([
      this.toDataUrl(this.eduLearnLogoUrl),
      this.toDataUrl(this.mascotUrls.earnings),
    ]);

    if (!params.entries.length) {
      const svgEmpty = await satori(
        {
          type: 'div',
          props: {
            style: {
              width: '1080px',
              height: '1080px',
              background: theme.background,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px',
            },
            children: [
              {
                type: 'div',
                props: {
                  children: titleUpper,
                  style: {
                    display: 'flex',
                    fontFamily: 'Satoshi',
                    fontSize: 24,
                    fontWeight: 600,
                    color: theme.success,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const,
                    marginBottom: 12,
                  },
                },
              },
              {
                type: 'div',
                props: {
                  children: params.monthLabel,
                  style: {
                    display: 'flex',
                    fontFamily: 'Satoshi',
                    fontSize: 40,
                    fontWeight: 700,
                    color: theme.foreground,
                    marginBottom: 24,
                  },
                },
              },
              {
                type: 'div',
                props: {
                  children: emptyBlurb,
                  style: {
                    display: 'flex',
                    fontFamily: 'Satoshi',
                    fontSize: 22,
                    color: theme.mutedForeground,
                    textAlign: 'center' as const,
                    maxWidth: '720px',
                    lineHeight: 1.5,
                  },
                },
              },
            ],
          },
        } as any,
        {
          width: 1080,
          height: 1080,
          fonts: [
            { name: 'Satoshi', data: this.regular!, weight: 400 },
            { name: 'Satoshi', data: this.bold!, weight: 700 },
          ],
        },
      );
      return Buffer.from(new Resvg(svgEmpty).render().asPng());
    }

    const themeIsDark = (params.theme ?? 'dark') === 'dark';

    const podiumPalette = themeIsDark
      ? {
          firstBg: '#00FF80',
          secondBg: '#2E3033',
          thirdBg: '#2E3033',
          firstText: '#000000',
          secondText: '#E0E0E0',
          thirdText: '#E0E0E0',
          firstMuted: '#000000',
          secondMuted: '#A0A0A0',
          thirdMuted: '#A0A0A0',
          avatarRing: '#FFFFFF',
          placeholderFill: '#131313',
        }
      : {
          firstBg: '#000000',
          secondBg: '#EDF3FC',
          thirdBg: '#F5F3FF',
          firstText: '#00FF66',
          secondText: '#2D3C52',
          thirdText: '#2D3C52',
          firstMuted: '#00FF66',
          secondMuted: '#61728C',
          thirdMuted: '#61728C',
          avatarRing: '#FFFFFF',
          placeholderFill: '#EDF3FC',
        };

    const entries = params.entries.slice(0, 3);
    const rowsResolved = await Promise.all(
      entries.map(async (e) => ({
        ...e,
        avatarDataUrl: await this.toDataUrl(
          this.getHighQualityImageUrl(e.avatarUrl || undefined) || undefined,
        ),
      })),
    );

    type ResolvedEntry = (typeof rowsResolved)[0];
    const byRank: Partial<Record<1 | 2 | 3, ResolvedEntry>> = {};
    for (const row of rowsResolved) {
      byRank[row.rank] = row;
    }

    const medalEmoji: Record<1 | 2 | 3, string> = {
      1: '🥇',
      2: '🥈',
      3: '🥉',
    };

    const slotLayout = {
      1: {
        width: 224,
        height: 312,
        paddingTop: 26,
        paddingX: 12,
        zIndex: 2,
        boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
      },
      2: {
        width: 200,
        height: 280,
        paddingTop: 22,
        paddingX: 12,
        zIndex: 1,
        boxShadow: '0 8px 16px rgba(0,0,0,0.22)',
      },
      3: {
        width: 192,
        height: 272,
        paddingTop: 22,
        paddingX: 12,
        zIndex: 1,
        boxShadow: '0 8px 16px rgba(0,0,0,0.22)',
      },
    } as const;

    const buildPodiumSlot = (rank: 1 | 2 | 3, e: ResolvedEntry | undefined) => {
      if (!e) return null;
      const layout = slotLayout[rank];
      const bg =
        rank === 1
          ? podiumPalette.firstBg
          : rank === 2
            ? podiumPalette.secondBg
            : podiumPalette.thirdBg;
      const nameColor =
        rank === 1
          ? podiumPalette.firstText
          : rank === 2
            ? podiumPalette.secondText
            : podiumPalette.thirdText;
      const xpColor =
        rank === 1
          ? podiumPalette.firstMuted
          : rank === 2
            ? podiumPalette.secondMuted
            : podiumPalette.thirdMuted;
      const subColor = xpColor;

      const avatarNode = e.avatarDataUrl
        ? {
            type: 'img',
            props: {
              src: e.avatarDataUrl,
              style: {
                width: '56px',
                height: '56px',
                borderRadius: '28px',
                objectFit: 'cover' as const,
              },
            },
          }
        : {
            type: 'div',
            props: {
              style: {
                width: '56px',
                height: '56px',
                borderRadius: '28px',
                background: podiumPalette.placeholderFill,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'Satoshi',
                fontSize: 22,
                color: xpColor,
              },
              children: '?',
            },
          };

      return {
        type: 'div',
        props: {
          style: {
            position: 'relative' as const,
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center' as const,
            width: `${layout.width}px`,
            minWidth: `${layout.width}px`,
            height: `${layout.height}px`,
            background: bg,
            borderRadius: '20px',
            paddingTop: `${layout.paddingTop}px`,
            paddingLeft: `${layout.paddingX}px`,
            paddingRight: `${layout.paddingX}px`,
            paddingBottom: '14px',
            boxSizing: 'border-box' as const,
            zIndex: layout.zIndex,
            boxShadow: layout.boxShadow,
            alignSelf: 'flex-end' as const,
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  position: 'absolute' as const,
                  top: '-28px',
                  fontSize: 44,
                  lineHeight: 1,
                  zIndex: 3,
                },
                children: medalEmoji[rank],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  background: podiumPalette.avatarRing,
                  borderRadius: '999px',
                  padding: '4px',
                  marginTop: '4px',
                  display: 'flex',
                },
                children: [avatarNode],
              },
            },
            {
              type: 'div',
              props: {
                children: e.name || e.username,
                style: {
                  display: 'flex',
                  fontFamily: 'Satoshi',
                  fontSize: rank === 1 ? 16 : 14,
                  fontWeight: 700,
                  color: nameColor,
                  marginTop: '10px',
                  textAlign: 'center' as const,
                  maxWidth: '100%',
                },
              },
            },
            {
              type: 'div',
              props: {
                children: `@${e.username}`,
                style: {
                  display: 'flex',
                  fontFamily: 'Satoshi',
                  fontSize: 12,
                  fontWeight: 500,
                  color: subColor,
                  marginTop: '4px',
                  textAlign: 'center' as const,
                  maxWidth: '100%',
                },
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'row' as const,
                  alignItems: 'center' as const,
                  marginTop: '8px',
                  gap: '6px',
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      children: '★',
                      style: {
                        fontSize: 14,
                        color: xpColor,
                      },
                    },
                  },
                  {
                    type: 'div',
                    props: {
                      children: `${e.xp.toLocaleString()} ${xpPillLabel}`,
                      style: {
                        display: 'flex',
                        fontFamily: 'Satoshi',
                        fontSize: 13,
                        fontWeight: 600,
                        color: xpColor,
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      };
    };

    const podiumSlots = [
      buildPodiumSlot(2, byRank[2]),
      buildPodiumSlot(1, byRank[1]),
      buildPodiumSlot(3, byRank[3]),
    ].filter((n) => n !== null);

    const podiumRow = {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'row' as const,
          justifyContent: 'center' as const,
          alignItems: 'flex-end' as const,
          gap: '10px',
          width: '100%',
          marginTop: '8px',
          marginBottom: '24px',
        },
        children: podiumSlots,
      },
    };

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            width: '1080px',
            height: '1080px',
            background: theme.background,
            display: 'flex',
            flexDirection: 'column',
            padding: '48px',
            position: 'relative' as const,
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '28px',
                },
                children: [
                  logoDataUrl
                    ? {
                        type: 'img',
                        props: {
                          src: logoDataUrl,
                          style: {
                            width: '88px',
                            height: '88px',
                            objectFit: 'contain' as const,
                          },
                        },
                      }
                    : {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            width: '88px',
                            height: '88px',
                          },
                        },
                      },
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            children: titleUpper,
                            style: {
                              display: 'flex',
                              fontFamily: 'Satoshi',
                              fontSize: 20,
                              fontWeight: 600,
                              color: theme.success,
                              letterSpacing: '0.08em',
                              textTransform: 'uppercase' as const,
                            },
                          },
                        },
                        {
                          type: 'div',
                          props: {
                            children: params.monthLabel,
                            style: {
                              display: 'flex',
                              fontFamily: 'Satoshi',
                              fontSize: 34,
                              fontWeight: 700,
                              color: theme.foreground,
                              marginTop: 6,
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
            {
              type: 'div',
              props: {
                style: {
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'stretch',
                  gap: '24px',
                  flex: 1,
                  minHeight: 0,
                },
                children: [
                  {
                    type: 'div',
                    props: {
                      style: {
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1,
                        minWidth: 0,
                      },
                      children: [
                        {
                          type: 'div',
                          props: {
                            children: bodyBlurb,
                            style: {
                              display: 'flex',
                              fontFamily: 'Satoshi',
                              fontSize: 18,
                              color: theme.mutedForeground,
                              marginBottom: '20px',
                              lineHeight: 1.4,
                            },
                          },
                        },
                        podiumRow,
                        {
                          type: 'div',
                          props: {
                            style: {
                              display: 'flex',
                              flexDirection: 'column',
                              marginTop: 'auto',
                              paddingTop: '16px',
                            },
                            children: [
                              {
                                type: 'div',
                                props: {
                                  children: 'edulearn.fun',
                                  style: {
                                    display: 'flex',
                                    fontFamily: 'Satoshi',
                                    fontSize: 22,
                                    fontWeight: 700,
                                    color: theme.mutedForeground,
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                  mascotDataUrl
                    ? {
                        type: 'img',
                        props: {
                          src: mascotDataUrl,
                          style: {
                            width: '320px',
                            height: '320px',
                            objectFit: 'contain' as const,
                            alignSelf: 'flex-end',
                            marginBottom: '-12px',
                          },
                        },
                      }
                    : {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            width: '320px',
                          },
                        },
                      },
                ],
              },
            },
          ],
        },
      } as any,
      {
        width: 1080,
        height: 1080,
        fonts: [
          { name: 'Satoshi', data: this.regular!, weight: 400 },
          { name: 'Satoshi', data: this.bold!, weight: 700 },
        ],
      },
    );

    const png = new Resvg(svg).render().asPng();
    return Buffer.from(png);
  }
}
