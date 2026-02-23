import * as React from 'react';
import { Section, Text, Img, Link } from '@react-email/components';

interface FeatureCardProps {
  icon?: string;
  title: string;
  description: string;
  ctaText?: string;
  ctaLink?: string;
}

export const FeatureCard = ({ icon, title, description, ctaText, ctaLink }: FeatureCardProps) => {
  return (
    <Section
      style={{
        backgroundColor: '#131313',
        border: '1px solid #2E3033',
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
          color: '#FFFFFF',
          fontSize: '20px',
          fontWeight: '600',
          margin: '0 0 12px 0',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: '#B3B3B3',
          fontSize: '16px',
          lineHeight: '24px',
          margin: '0',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          {ctaText} →
        </Link>
      )}
    </Section>
  );
};
