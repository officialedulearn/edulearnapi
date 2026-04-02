import * as React from 'react';
import { Section, Text, Img } from '@react-email/components';
import { EmailLayout } from '../components/EmailLayout';
import { Button } from '../components/Button';
import { MASCOT_URLS } from '../constants';
import type {
  NftListingBroadcastData,
  NftListingItem,
} from '../nft-listing-announcement.config';

export type NftListingAnnouncementEmailProps = NftListingBroadcastData & {
  useResendUnsubscribe?: boolean;
  useResendFirstName?: boolean;
};

const fontStack = `'Urbanist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;

function NftRow({ nft }: { nft: NftListingItem }) {
  return (
    <Section
      style={{
        backgroundColor: '#FFFFFF',
        border: '1px solid #EDF3FC',
        borderRadius: '12px',
        padding: '16px',
        marginBottom: '12px',
      }}
    >
      <table
        role="presentation"
        cellPadding={0}
        cellSpacing={0}
        width="100%"
        style={{ borderCollapse: 'collapse' }}
      >
        <tbody>
          <tr>
            <td
              style={{
                verticalAlign: 'top',
                width: '120px',
                paddingRight: '16px',
              }}
            >
              {nft.imageUrl ? (
                <Img
                  src={nft.imageUrl}
                  alt={nft.title || 'NFT'}
                  width={104}
                  height={104}
                  style={{
                    width: '104px',
                    height: '104px',
                    borderRadius: '12px',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : null}
            </td>
            <td style={{ verticalAlign: 'top' }}>
              <Text
                style={{
                  color: '#00FF80',
                  fontSize: '12px',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  margin: '0 0 6px 0',
                  fontFamily: fontStack,
                }}
              >
                {nft.header}
              </Text>
              <Text
                style={{
                  color: '#2D3C52',
                  fontSize: '20px',
                  fontWeight: '700',
                  lineHeight: '26px',
                  margin: '0 0 8px 0',
                  fontFamily: fontStack,
                }}
              >
                {nft.title}
              </Text>
              <Text
                style={{
                  color: '#61728C',
                  fontSize: '14px',
                  lineHeight: '21px',
                  margin: '0',
                  fontFamily: fontStack,
                }}
              >
                {nft.description}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}

export const NftListingAnnouncementEmail = ({
  previewText,
  howToEarnText,
  nfts,
  ctaUrl,
  ctaLabel,
  useResendUnsubscribe,
  useResendFirstName,
}: NftListingAnnouncementEmailProps) => {
  const mascotUrl = MASCOT_URLS.proud;
  const displayName = useResendFirstName ? '{{{FIRST_NAME|Learner}}}' : 'there';
  const visibleNfts = nfts.filter(
    (n) =>
      n.imageUrl?.trim() ||
      n.title?.trim() ||
      n.description?.trim() ||
      n.header?.trim(),
  );

  return (
    <EmailLayout
      previewText={previewText}
      useResendUnsubscribe={useResendUnsubscribe}
    >
      <Section style={{ padding: '24px 24px 0', textAlign: 'center' }}>
        <Img
          src={mascotUrl}
          alt="Eddy"
          width={160}
          height={160}
          style={{ margin: '0 auto 24px', display: 'block' }}
        />
        <Text
          style={{
            color: '#2D3C52',
            fontSize: '28px',
            fontWeight: '700',
            margin: '0 0 8px 0',
            fontFamily: fontStack,
          }}
        >
          New NFT listings 🏆
        </Text>
        <Text
          style={{
            color: '#61728C',
            fontSize: '16px',
            lineHeight: '24px',
            margin: '0 0 24px 0',
            fontFamily: fontStack,
          }}
        >
          Hey {displayName}! Eddy spotted something new in the marketplace.
        </Text>
      </Section>

      <Section style={{ padding: '0 24px 24px' }}>
        {visibleNfts.length > 0 ? (
          visibleNfts.map((nft, i) => (
            <NftRow key={`${nft.title}-${i}`} nft={nft} />
          ))
        ) : (
          <Text
            style={{
              color: '#61728C',
              fontSize: '14px',
              fontFamily: fontStack,
            }}
          >
            New certificates are on the way—check the app for the latest.
          </Text>
        )}

        {howToEarnText?.trim() ? (
          <Section
            style={{
              marginTop: '20px',
              padding: '16px 18px',
              backgroundColor: '#F9FBFC',
              border: '1px solid #EDF3FC',
              borderRadius: '12px',
            }}
          >
            <Text
              style={{
                color: '#2D3C52',
                fontSize: '14px',
                fontWeight: '600',
                margin: '0 0 8px 0',
                fontFamily: fontStack,
              }}
            >
              How to earn an NFT
            </Text>
            <Text
              style={{
                color: '#61728C',
                fontSize: '14px',
                lineHeight: '22px',
                margin: '0',
                fontFamily: fontStack,
              }}
            >
              {howToEarnText}
            </Text>
          </Section>
        ) : null}

        <Section style={{ textAlign: 'center', marginTop: '28px' }}>
          <Button href={ctaUrl}>{ctaLabel}</Button>
        </Section>
      </Section>
    </EmailLayout>
  );
};

export default NftListingAnnouncementEmail;
