import * as React from 'react';
import { Section, Text } from '@react-email/components';
import { EmailLayout } from '../components/EmailLayout';
import { HeroSection } from '../components/HeroSection';
import { FeatureCard } from '../components/FeatureCard';
import { MASCOT_URLS, APP_URL } from '../constants';

interface EddyWeeklyTipEmailProps {
  name?: string;
  tip?: string;
  useResendUnsubscribe?: boolean;
  useResendFirstName?: boolean;
}

const DEFAULT_TIP = {
  title: 'Try the AI Tutor',
  description: 'Stuck on a concept? Chat with our AI tutor—it explains topics in plain language and adapts to your level. Perfect for quick questions or deep dives.',
};

export const EddyWeeklyTipEmail = ({ name = 'Learner', tip, useResendUnsubscribe, useResendFirstName }: EddyWeeklyTipEmailProps) => {
  const mascotUrl = MASCOT_URLS.mischievous;
  const tipContent = tip ? { title: tip, description: '' } : DEFAULT_TIP;
  const displayName = useResendFirstName ? '{{{FIRST_NAME|Learner}}}' : name;

  return (
    <EmailLayout previewText="Eddy's weekly tip: A quick way to level up your learning." useResendUnsubscribe={useResendUnsubscribe}>
      <HeroSection
        mascotUrl={mascotUrl}
        headline="Eddy's Weekly Tip 🐸"
        subheadline="A little nudge from Eddy to help you learn smarter."
        ctaText="Try It Now"
        ctaLink={APP_URL}
      />

      <Section style={{ padding: '0 24px 40px' }}>
        <FeatureCard
          title={tipContent.title}
          description={tipContent.description || 'Open the app and explore—Eddy has something new for you!'}
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
          {displayName}, small steps add up. See you in the app!
        </Text>
      </Section>
    </EmailLayout>
  );
};

export default EddyWeeklyTipEmail;
