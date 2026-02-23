import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Img,
  Text,
  Link,
  Hr,
} from '@react-email/components';

interface EmailLayoutProps {
  children: React.ReactNode;
  previewText?: string;
}

export const EmailLayout = ({ children, previewText }: EmailLayoutProps) => {
  const logoUrl = 'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/logo.png';

  return (
    <Html>
      <Head />
      <Body
        style={{
          backgroundColor: '#0D0D0D',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: '600px',
            margin: '0 auto',
            padding: '0',
          }}
        >
          <Section
            style={{
              padding: '32px 24px 24px',
              textAlign: 'center',
            }}
          >
            <Img
              src={logoUrl}
              alt="EduLearn"
              width="120"
              height="40"
              style={{
                margin: '0 auto',
                display: 'block',
              }}
            />
          </Section>

          {children}

          <Hr
            style={{
              borderColor: '#2E3033',
              margin: '32px 0',
            }}
          />

          <Section
            style={{
              padding: '0 24px 32px',
              textAlign: 'center',
            }}
          >
            <Text
              style={{
                color: '#00FF80',
                fontSize: '16px',
                fontWeight: '600',
                margin: '0 0 16px 0',
              }}
            >
              Keep learning, keep earning!
            </Text>
            <Text
              style={{
                color: '#B3B3B3',
                fontSize: '14px',
                margin: '0 0 8px 0',
              }}
            >
              Questions? Contact us at{' '}
              <Link
                href="mailto:eddy@edulearn.fun"
                style={{
                  color: '#00FF80',
                  textDecoration: 'none',
                }}
              >
                eddy@edulearn.fun
              </Link>
            </Text>
            <Text
              style={{
                color: '#B3B3B3',
                fontSize: '12px',
                margin: '16px 0 0 0',
              }}
            >
              © {new Date().getFullYear()} EduLearn. All rights reserved.
            </Text>
            <Text
              style={{
                color: '#B3B3B3',
                fontSize: '12px',
                margin: '8px 0 0 0',
              }}
            >
              <Link
                href="https://edulearn.fun/unsubscribe"
                style={{
                  color: '#B3B3B3',
                  textDecoration: 'underline',
                }}
              >
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};
