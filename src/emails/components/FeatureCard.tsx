import * as React from 'react';
import { Section, Text, Img, Link } from '@react-email/components';

interface FeatureCardProps {
  icon?: string;
  title: string;
  description: string;
  ctaText?: string;
  ctaLink?: string;
}

const fontStack = `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

export const FeatureCard = ({
  icon,
  title,
  description,
  ctaText,
  ctaLink,
}: FeatureCardProps) => {
  return (
    <Section
      style={{
        backgroundColor: '#FFFFFF',
        border: '1px solid #EDF3FC',
        borderRadius: '12px',
        padding: '24px',
        marginBottom: '16px',
      }}
    >
      {icon && (
        <Img
          src={icon}
          alt={title}
          width="48"
          height="48"
          style={{
            marginBottom: '16px',
          }}
        />
      )}
      <Text
        style={{
          color: '#2D3C52',
          fontSize: '20px',
          fontWeight: '600',
          margin: '0 0 12px 0',
          fontFamily: fontStack,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: '#61728C',
          fontSize: '16px',
          lineHeight: '24px',
          margin: '0',
          fontFamily: fontStack,
        }}
      >
        {description}
      </Text>
      {ctaText && ctaLink && (
        <Link
          href={ctaLink}
          style={{
            color: '#00FF80',
            fontSize: '14px',
            fontWeight: '600',
            marginTop: '12px',
            display: 'inline-block',
            textDecoration: 'none',
            fontFamily: fontStack,
          }}
        >
          {ctaText} →
        </Link>
      )}
    </Section>
  );
};
