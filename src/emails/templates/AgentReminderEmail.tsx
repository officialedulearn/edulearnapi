import * as React from 'react';
import { Section, Text } from '@react-email/components';
import { EmailLayout } from '../components/EmailLayout';
import { HeroSection } from '../components/HeroSection';
import { FeatureCard } from '../components/FeatureCard';
import { MASCOT_URLS, APP_URL } from '../constants';

interface AgentReminderEmailProps {
  name?: string;
  agentName?: string;
  agentProfilePictureUrl?: string;
  goalText?: string;
  personalizedRecap: string;
  tip: string;
  useResendUnsubscribe?: boolean;
  useResendFirstName?: boolean;
}

export const AgentReminderEmail = ({
  name = 'Learner',
  agentName = 'Eddy',
  agentProfilePictureUrl,
  goalText,
  personalizedRecap,
  tip,
  useResendUnsubscribe,
  useResendFirstName,
}: AgentReminderEmailProps) => {
  const mascotUrl = agentProfilePictureUrl?.trim()
    ? agentProfilePictureUrl.trim()
    : MASCOT_URLS.curious;
  const displayName = useResendFirstName ? '{{{FIRST_NAME|Learner}}}' : name;
  const goalLabel = (goalText || '').trim();

  return (
    <EmailLayout
      previewText={`A quick personalized check-in from ${agentName}.`}
      useResendUnsubscribe={useResendUnsubscribe}
    >
      <HeroSection
        mascotUrl={mascotUrl}
        headline={`Quick check-in from ${agentName}`}
        subheadline={
          goalLabel
            ? `A small nudge to help you hit your goal: ${goalLabel}`
            : 'A small nudge to keep your learning momentum going.'
        }
        ctaText="Open EduLearn"
        ctaLink={APP_URL}
      />

      <Section style={{ padding: '0 24px 40px' }}>
        <FeatureCard
          title="Your recent quiz performance"
          description={personalizedRecap}
        />
        <FeatureCard title="A tip to improve" description={tip} />

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
          {displayName}, keep it light—one small step today is enough.
          <br />
          — {agentName}
        </Text>
      </Section>
    </EmailLayout>
  );
};

export default AgentReminderEmail;
