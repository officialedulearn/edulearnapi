import * as React from 'react';
import { Section, Text } from '@react-email/components';
import { EmailLayout } from '../components/EmailLayout';
import { HeroSection } from '../components/HeroSection';
import { MASCOT_URLS, APP_URL } from '../constants';

interface ComeBackSoonEmailProps {
  name?: string;
  useResendUnsubscribe?: boolean;
  useResendFirstName?: boolean;
}

export const ComeBackSoonEmail = ({ name = 'Learner', useResendUnsubscribe, useResendFirstName }: ComeBackSoonEmailProps) => {
  const mascotUrl = MASCOT_URLS.curious;
  const displayName = useResendFirstName ? '{{{FIRST_NAME|Learner}}}' : name;

  return (
    <EmailLayout previewText="We miss you! Eddy and EduLearn are waiting for you." useResendUnsubscribe={useResendUnsubscribe}>
      <HeroSection
        mascotUrl={mascotUrl}
        headline="We Miss You! 🐸"
        subheadline="Eddy noticed you haven't been around. Your learning journey is waiting—come pick up where you left off."
        ctaText="Open EduLearn"
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
          Hey {displayName}! Quick quizzes, AI tutor chats, and your roadmaps are just a tap away. Eddy is here to cheer you on whenever you're ready.
        </Text>
      </Section>
    </EmailLayout>
  );
};

export default ComeBackSoonEmail;
