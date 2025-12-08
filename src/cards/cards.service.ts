import { Injectable } from '@nestjs/common';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import axios from 'axios';

@Injectable()
export class CardsService {
  private regular?: Buffer;
  private bold?: Buffer;

  private async loadFonts() {
    if (this.regular && this.bold) return;
    const cssRes = await axios.get('https://fonts.cdnfonts.com/css/satoshi');
    const urls: string[] = [];
    const regex = /url\(['"]?([^'"\)]+\.ttf)['"]?\)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(cssRes.data)) !== null) {
      urls.push(m[1]);
    }
    const regularUrl = urls.find((u) => /Regular/i.test(u)) ?? urls[0];
    const boldUrl = urls.find((u) => /Bold(?! Italic)/i.test(u)) ?? urls.find((u) => /Black/i.test(u)) ?? urls[1] ?? urls[0];
    const [regularRes, boldRes] = await Promise.all([
      axios.get(regularUrl, { responseType: 'arraybuffer' }),
      axios.get(boldUrl, { responseType: 'arraybuffer' }),
    ]);
    this.regular = Buffer.from(regularRes.data);
    this.bold = Buffer.from(boldRes.data);
  }

  private getTheme(theme: 'light' | 'dark') {
    if (theme === 'dark') {
      return {
        background: '#0D0D0D',
        card: '#212121',
        foreground: '#FFFFFF',
        mutedForeground: '#B3B3B3',
        border: 'rgba(255,255,255,0.1)',
        ring: '#2E3033',
        success: '#00FF80',
      };
    }
    return {
      background: '#F9FBFC',
      card: '#FFFFFF',
      foreground: '#2D3C52',
      mutedForeground: '#61728C',
      border: '#EDF3FC',
      ring: '#EDF3FC',
      success: '#00FF80',
    };
  }

  private async toDataUrl(url?: string): Promise<string | undefined> {
    if (!url) return undefined;
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    const mime = res.headers['content-type'] || 'image/png';
    const base64 = Buffer.from(res.data).toString('base64');
    return `data:${mime};base64,${base64}`;
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
                        fontFamily: 'Satoshi Regular',
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
                        fontFamily: 'Satoshi Bold',
                        fontSize: 60,
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
                        fontFamily: 'Satoshi Regular',
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
                            fontFamily: 'Satoshi Regular',
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
        width: 1200,
        height: 630,
        fonts: [
          { name: 'Satoshi Regular', data: this.regular!, weight: 400 },
          { name: 'Satoshi Bold', data: this.bold!, weight: 700 },
        ],
      },
    );

    const png = new Resvg(svg).render().asPng();
    return Buffer.from(png);
  }
}
