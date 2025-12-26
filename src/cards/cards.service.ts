import { Injectable, OnModuleInit } from '@nestjs/common';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import axios from 'axios';
import db from '../../drizzle';
import { user } from '../../lib/db/schema';
import { eq } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { decompress } from 'wawoff2';

@Injectable()
export class CardsService implements OnModuleInit {
  private regular?: Buffer;
  private bold?: Buffer;
  private imageCache: Map<string, string> = new Map();
  private isWarmedUp = false;

  private readonly mascotUrls = {
    streak: 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/streak.png',
    earnings: 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/Celebrate.png',
    level: 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/proud.png',
  };

  private readonly eduLearnLogoUrl = 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/logo.png';

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
      ]);
      this.isWarmedUp = true;
      console.log('Image cache warmed up successfully');
    } catch (error) {
      console.error('Failed to warm up cache:', error);
    }
  }

  private getHighQualityImageUrl(url: string | null | undefined): string | undefined {
    if (!url || typeof url !== 'string') return undefined;
    return url
      .replace(/_normal(\.[a-z]+)$/i, '_400x400$1')
      .replace(/_mini(\.[a-z]+)$/i, '_400x400$1')
      .replace(/_bigger(\.[a-z]+)$/i, '_400x400$1');
  }

  private async loadFonts() {
    if (this.regular && this.bold) return;
    
    try {
      const regularPath = path.join(process.cwd(), 'public/fonts/Satoshi-Regular.otf');
      const boldPath = path.join(process.cwd(), 'public/fonts/Satoshi-Bold.otf');
      
      this.regular = fs.readFileSync(regularPath);
      this.bold = fs.readFileSync(boldPath);
      console.log('Loaded Satoshi fonts successfully');
    } catch (satoshiError) {
      console.error('Satoshi fonts not found, trying Urbanist...');
      try {
        const regularPath = path.join(process.cwd(), 'node_modules/@fontsource/urbanist/files/urbanist-latin-400-normal.woff2');
        const boldPath = path.join(process.cwd(), 'node_modules/@fontsource/urbanist/files/urbanist-latin-900-normal.woff2');
        
        const regularWoff2 = fs.readFileSync(regularPath);
        const boldWoff2 = fs.readFileSync(boldPath);
        
        this.regular = Buffer.from(await decompress(regularWoff2));
        this.bold = Buffer.from(await decompress(boldWoff2));
        console.log('Loaded Urbanist fonts as fallback');
      } catch (urbanistError) {
        console.error('Urbanist not found, falling back to Inter');
        const regularPath = path.join(process.cwd(), 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2');
        const boldPath = path.join(process.cwd(), 'node_modules/@fontsource/inter/files/inter-latin-900-normal.woff2');
        
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
                      children: params?.subtitle ?? 'AI-powered learning platform',
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
      },
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
    console.log(`[StreakCard] DB + Fonts loaded in ${Date.now() - startTime}ms`);
    
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
    console.log(`[StreakCard] Images loaded in ${Date.now() - imageStartTime}ms`);

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
                              avatarDataUrl ? {
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
                              } : {
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
                  mascotDataUrl ? {
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
                  } : {
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
      },
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
    console.log(`[StreakCard] PNG rendered in ${Date.now() - renderStartTime}ms`);
    console.log(`[StreakCard] Total time: ${Date.now() - startTime}ms`);
    return Buffer.from(png);
  }

  async generateEarningsCard(params: {
    userId: string;
    theme?: 'light' | 'dark';
  }): Promise<Buffer> {
    await this.loadFonts();
    
    const userData = await db.select().from(user).where(eq(user.id, params.userId)).limit(1);
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
                              avatarDataUrl ? {
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
                              } : {
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
                                        children: (u.referralCount || 0).toString(),
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
                  mascotDataUrl ? {
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
                  } : {
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
      },
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
    
    const userData = await db.select().from(user).where(eq(user.id, params.userId)).limit(1);
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
                        avatarDataUrl ? {
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
                        } : {
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
      },
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
