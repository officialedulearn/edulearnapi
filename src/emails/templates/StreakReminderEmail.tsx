import * as React from 'react';
import { Section, Text } from '@react-email/components';
import { EmailLayout } from '../components/EmailLayout';
import { HeroSection } from '../components/HeroSection';
import { MASCOT_URLS, APP_URL } from '../constants';

interface StreakReminderEmailProps {
  name?: string;
  useResendUnsubscribe?: boolean;
  useResendFirstName?: boolean;
}

export const StreakReminderEmail = ({ name = 'Learner', useResendUnsubscribe, useResendFirstName }: StreakReminderEmailProps) => {
  const mascotUrl = MASCOT_URLS.proud;
  const displayName = useResendFirstName ? '{{{FIRST_NAME|Learner}}}' : name;

  return (
    <EmailLayout previewText="Don't break your streak! Eddy is rooting for you." useResendUnsubscribe={useResendUnsubscribe}>
      <HeroSection
        mascotUrl={mascotUrl}
        headline="Don't Break Your Streak! 🔥"
        subheadline="A quick quiz or chat today keeps your streak alive. Eddy is proud of your progress—keep it going!"
        ctaText="Continue Learning"
        ctaLink={APP_URL}
      />

      <Section style={{ padding: '0 24px 40px' }}>
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
          Hey {displayName}! Consistency is key. Open the app, complete a quick activity, and Eddy will celebrate with you.
        </Text>
      </Section>
    </EmailLayout>
  );
};

export default StreakReminderEmail;
