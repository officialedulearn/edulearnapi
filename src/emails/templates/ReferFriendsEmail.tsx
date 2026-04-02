import * as React from 'react';
import { Section, Text } from '@react-email/components';
import { EmailLayout } from '../components/EmailLayout';
import { HeroSection } from '../components/HeroSection';
import { FeatureCard } from '../components/FeatureCard';
import { MASCOT_URLS, APP_URL } from '../constants';

interface ReferFriendsEmailProps {
  name?: string;
  referralCode?: string;
  useResendUnsubscribe?: boolean;
  useResendFirstName?: boolean;
}

export const ReferFriendsEmail = ({
  name = 'Learner',
  referralCode = 'ABC123',
  useResendUnsubscribe,
  useResendFirstName,
}: ReferFriendsEmailProps) => {
  const mascotUrl = MASCOT_URLS.celebrate;
  const displayName = useResendFirstName ? '{{{FIRST_NAME|Learner}}}' : name;

  return (
    <EmailLayout
      previewText="Share your referral code and earn rewards together!"
      useResendUnsubscribe={useResendUnsubscribe}
    >
      <HeroSection
        mascotUrl={mascotUrl}
        headline="Refer Friends, Earn Together 🎉"
        subheadline="Share EduLearn with friends—you both win! +5 XP when they join, 20% commission when they go premium."
        ctaText="Share Your Code"
        ctaLink={APP_URL}
      />

      <Section style={{ padding: '0 24px 40px' }}>
        <Text
          style={{
            color: '#2D3C52',
            fontSize: '20px',
            fontWeight: '600',
            textAlign: 'center',
            margin: '0 0 16px 0',
            fontFamily: `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
          }}
        >
          Your Referral Code
        </Text>
        <Section
          style={{
            backgroundColor: '#000',
            borderRadius: '12px',
            padding: '20px',
            textAlign: 'center',
            marginBottom: '24px',
          }}
        >
          <Text
            style={{
              color: '#00FF80',
              fontSize: '24px',
              fontWeight: '700',
              letterSpacing: '2px',
              fontFamily: 'monospace',
              margin: '0',
            }}
          >
            {referralCode}
          </Text>
        </Section>

        <FeatureCard
          title="+5 XP Each"
          description="You and your friend both get +5 XP when they sign up with your code."
        />
        <FeatureCard
          title="20% Commission"
          description="When a referred friend goes premium, you earn 20% of their subscription as affiliate rewards."
        />

        <Text
          style={{
            color: '#61728C',
            fontSize: '16px',
            lineHeight: '24px',
            textAlign: 'center',
            margin: '24px 0 0 0',
            fontFamily: `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
          }}
        >
          {displayName}, your friends will love learning with Eddy. Share your
          code and grow together!
        </Text>
      </Section>
    </EmailLayout>
  );
};

export default ReferFriendsEmail;
