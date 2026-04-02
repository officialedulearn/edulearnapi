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
  useResendUnsubscribe?: boolean;
}

export const EmailLayout = ({
  children,
  previewText,
  useResendUnsubscribe,
}: EmailLayoutProps) => {
  const logoUrl =
    'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/media/logo.png';

  const fontStack = `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

  return (
    <Html>
      <Head>
        <link
          href="https://fonts.googleapis.com/css2?family=Urbanist:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <Body
        style={{
          backgroundColor: '#F9FBFC',
          fontFamily: fontStack,
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
              borderColor: '#EDF3FC',
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
                fontFamily: fontStack,
              }}
            >
              Keep learning, keep earning!
            </Text>
            <Text
              style={{
                color: '#61728C',
                fontSize: '14px',
                margin: '0 0 8px 0',
                fontFamily: fontStack,
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
                color: '#61728C',
                fontSize: '12px',
                margin: '16px 0 0 0',
                fontFamily: fontStack,
              }}
            >
              © {new Date().getFullYear()} EduLearn. All rights reserved.
            </Text>
            <Text
              style={{
                color: '#61728C',
                fontSize: '12px',
                margin: '8px 0 0 0',
                fontFamily: fontStack,
              }}
            >
              <Link
                href={
                  useResendUnsubscribe
                    ? '{{{RESEND_UNSUBSCRIBE_URL}}}'
                    : 'https://edulearn.fun/unsubscribe'
                }
                style={{
                  color: '#61728C',
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
