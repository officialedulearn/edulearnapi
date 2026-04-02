import * as React from 'react';
import { Section, Text } from '@react-email/components';
import { EmailLayout } from '../components/EmailLayout';
import { HeroSection } from '../components/HeroSection';
import { MASCOT_URLS, APP_URL } from '../constants';

interface ReferralSuperstarEmailProps {
  name?: string;
  referralCount?: number;
  referralCode?: string;
  useResendUnsubscribe?: boolean;
  useResendFirstName?: boolean;
}

export const ReferralSuperstarEmail = ({
  name = 'Learner',
  referralCount = 5,
  referralCode = 'ABC123',
  useResendUnsubscribe,
  useResendFirstName,
}: ReferralSuperstarEmailProps) => {
  const mascotUrl = MASCOT_URLS.celebrate;
  const displayName = useResendFirstName ? '{{{FIRST_NAME|Learner}}}' : name;

  return (
    <EmailLayout
      previewText="You're a referral superstar! Keep sharing and earning."
      useResendUnsubscribe={useResendUnsubscribe}
    >
      <HeroSection
        mascotUrl={mascotUrl}
        headline="You're a Referral Superstar! 🌟"
        subheadline={`You've referred ${referralCount} friend${referralCount === 1 ? '' : 's'}! Eddy is celebrating—and so should you.`}
        ctaText="Share More"
        ctaLink={APP_URL}
      />

      <Section style={{ padding: '0 24px 40px' }}>
        <Section
          style={{
            backgroundColor: '#000',
            borderRadius: '12px',
            padding: '24px',
            textAlign: 'center',
            marginBottom: '24px',
          }}
        >
          <Text
            style={{
              color: '#00FF80',
              fontSize: '14px',
              fontWeight: '600',
              margin: '0 0 8px 0',
              fontFamily: `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
            }}
          >
            Your Code: {referralCode}
          </Text>
          <Text
            style={{
              color: '#E0E0E0',
              fontSize: '28px',
              fontWeight: '700',
              margin: '0',
              fontFamily: `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
            }}
          >
            {referralCount} referral{referralCount === 1 ? '' : 's'}
          </Text>
        </Section>

        <Text
          style={{
            color: '#61728C',
            fontSize: '16px',
            lineHeight: '24px',
            textAlign: 'center',
            margin: '0',
            fontFamily: `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
          }}
        >
          {displayName}, every referral helps someone discover EduLearn. Keep
          sharing your code and earn more rewards when they go premium!
        </Text>
      </Section>
    </EmailLayout>
  );
};

export default ReferralSuperstarEmail;
