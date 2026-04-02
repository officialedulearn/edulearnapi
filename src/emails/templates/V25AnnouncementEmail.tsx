import * as React from 'react';
import { Section, Text } from '@react-email/components';
import { EmailLayout } from '../components/EmailLayout';
import { HeroSection } from '../components/HeroSection';
import { FeatureCard } from '../components/FeatureCard';

interface V25AnnouncementEmailProps {
  name: string;
}

export const V25AnnouncementEmail = ({
  name = 'Learner',
}: V25AnnouncementEmailProps) => {
  const mascotUrl =
    'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/Celebrate.png';
  const appUrl = 'https://edulearn.fun';

  return (
    <EmailLayout previewText="Introducing EduLearn v2.5 - Your learning journey just got social!">
      <HeroSection
        mascotUrl={mascotUrl}
        headline="Introducing EduLearn v2.5 🎉"
        subheadline="Your learning journey just got social, rewarding, and more fun!"
        ctaText="Try New Features"
        ctaLink={appUrl}
      />

      <Section
        style={{
          padding: '0 24px 40px',
        }}
      >
        <Text
          style={{
            color: '#2D3C52',
            fontSize: '24px',
            fontWeight: '600',
            textAlign: 'center',
            margin: '0 0 32px 0',
            fontFamily: `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
          }}
        >
          What's New in v2.5
        </Text>

        <FeatureCard
          title="Follow & Get Inspired 👥"
          description="Follow other learners and get notified when they level up, earn NFTs, or hit milestones. Learn together, grow together!"
        />

        <FeatureCard
          title="Learn Together in Communities 💬"
          description="Join communities, chat with fellow learners in real-time, share tips, and celebrate wins together!"
        />

        <FeatureCard
          title="Claim NFT Badges Instantly 🏆"
          description="Seamlessly purchase and mint NFT certificates with RevenueCat. Your achievements, on the blockchain!"
        />

        <FeatureCard
          title="Share Your Wins 🎨"
          description="Generate beautiful cards for your streaks, earnings, level-ups, and NFTs. Share on social media and inspire others!"
        />

        <FeatureCard
          title="Say Hi to Eddy! 🐸"
          description="Our new mascot is here to cheer you on! You'll see Eddy celebrating your wins, offering tips, and making learning fun."
        />

        <FeatureCard
          title="Now Live on Seeker & App Store 📱"
          description="v2.5 is now available on the Seeker dApp Store and the App Store. Download or update to get the latest features!"
        />

        <Text
          style={{
            color: '#61728C',
            fontSize: '16px',
            lineHeight: '24px',
            textAlign: 'center',
            margin: '32px 0 0 0',
            fontFamily: `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
          }}
        >
          Hi {name}! We've been working hard to make EduLearn more engaging and
          rewarding for you. These new features are designed to help you connect
          with other learners, celebrate your achievements, and make your
          learning journey more fun than ever.
        </Text>

        <Text
          style={{
            color: '#61728C',
            fontSize: '16px',
            lineHeight: '24px',
            textAlign: 'center',
            margin: '16px 0 0 0',
            fontFamily: `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`,
          }}
        >
          Jump in and explore all the new features today!
        </Text>
      </Section>
    </EmailLayout>
  );
};

export default V25AnnouncementEmail;
