export type NftListingItem = {
  header: string;
  title: string;
  description: string;
  imageUrl: string;
};

export const DEFAULT_HOW_TO_EARN_TEXT =
  'To get an NFT, learn about the topic on the chatbot, generate a roadmap for it, and complete it.';

export type NftListingBroadcastData = {
  subject: string;
  previewText: string;
  howToEarnText: string;
  nfts: NftListingItem[];
  ctaUrl: string;
  ctaLabel: string;
};

export const NFT_LISTING_BROADCAST_DATA: NftListingBroadcastData = {
  subject: 'New NFT listings on EduLearn 🏆',
  previewText: 'Fresh badge certificates just dropped—check them out!',
  howToEarnText: DEFAULT_HOW_TO_EARN_TEXT,
  nfts: [
    {
      header: 'New',
      title: 'Smart Contract Basics Badge',
      description:
        'A mark of foundational wisdom, showing your ability to understand the code‑driven rules that power decentralized interactions.',
      imageUrl:
        'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/nfts/photo_2026-03-31_00-23-00.jpg',
    },
    {
      header: 'New',
      title: 'Basic Security Awareness',
      description:
        'A badge of vigilance, showing your ability to spot risks, protect your wallet, and navigate Web3 safely with smart security habits.',
      imageUrl:
        'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/nfts/photo_2026-03-31_00-22-51.jpg',
    },
    {
      header: 'New',
      title: 'Web3 Product Basics',
      description:
        'Proof you understand the fundamentals of decentralized apps, smart contracts, and blockchain-powered user experiences.',
      imageUrl:
        'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/nfts/photo_2026-03-31_00-21-53.jpg',
    },
    {
      header: 'New',
      title: 'Community And Growth Role-Play',
      description:
        'Proof you can engage, build, and grow a thriving Web3 community through strategy, storytelling, and real user connection.',
      imageUrl:
        'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/nfts/photo_2026-03-31_00-22-44.jpg',
    },
    {
      header: 'New',
      title: 'DApp Frontend Integration',
      description:
        'A token of digital synergy, celebrating your understanding of how web interfaces sync with wallets, networks, and on‑chain systems.',
      imageUrl:
        'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/nfts/photo_2026-03-31_00-23-04.jpg',
    },
    {
      header: 'New',
      title: 'AMMs & Lending Mechanics',
      description:
        'A mark of your understanding of automated market makers, liquidity flows, and decentralized lending systems powering DeFi.',
      imageUrl:
        'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/nfts/photo_2026-03-31_00-22-57.jpg',
    },
    {
      header: 'New',
      title: 'Blockchain Data Querying',
      description:
        'A token of analytical power, recognizing your capacity to query, decode, and illuminate the ever‑moving world of on‑chain activity',
      imageUrl:
        'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/nfts/photo_2026-03-31_00-22-54.jpg',
    },
    {
      header: 'New',
      title: 'Web3 Explainer',
      description:
        'You’ve unlocked the power to break down blockchain, wallets, and decentralization into simple ideas. A badge of clarity in a complex digital world.',
      imageUrl:
        'https://lmektyexzejjvisjpzxu.supabase.co/storage/v1/object/public/nfts/photo_2026-03-31_00-22-40.jpg',
    },
  ],
  ctaUrl: 'https://edulearn.fun/rewards',
  ctaLabel: 'View listings',
};

export function mergeNftListingBroadcastData(
  partial?: Partial<NftListingBroadcastData>,
): NftListingBroadcastData {
  const out: NftListingBroadcastData = {
    ...NFT_LISTING_BROADCAST_DATA,
    nfts: NFT_LISTING_BROADCAST_DATA.nfts.map((n) => ({ ...n })),
  };
  if (!partial) return out;
  for (const key of Object.keys(partial) as (keyof NftListingBroadcastData)[]) {
    const v = partial[key];
    if (v === undefined) continue;
    if (key === 'nfts' && Array.isArray(v)) {
      out.nfts = v.map((item) => ({ ...item }));
    } else {
      (out as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}
