import * as React from 'react';
import { Section, Img, Heading, Text } from '@react-email/components';
import { Button } from './Button';

interface HeroSectionProps {
  mascotUrl: string;
  headline: string;
  subheadline: string;
  ctaText: string;
  ctaLink: string;
}

const fontStack = `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

export const HeroSection = ({
  mascotUrl,
  headline,
  subheadline,
  ctaText,
  ctaLink,
}: HeroSectionProps) => {
  return (
    <Section
      style={{
        textAlign: 'center',
        padding: '40px 20px',
      }}
    >
      <Img
        src={mascotUrl}
        alt="EduLearn Mascot"
        width="200"
        height="200"
        style={{
          margin: '0 auto 32px',
          display: 'block',
        }}
      />
      <Heading
        style={{
          color: '#2D3C52',
          fontSize: '32px',
          fontWeight: '700',
          margin: '0 0 16px 0',
          fontFamily: fontStack,
        }}
      >
        {headline}
      </Heading>
      <Text
        style={{
          color: '#61728C',
          fontSize: '18px',
          lineHeight: '28px',
          margin: '0 0 32px 0',
          fontFamily: fontStack,
        }}
      >
        {subheadline}
      </Text>
      <Button href={ctaLink}>{ctaText}</Button>
    </Section>
  );
};
