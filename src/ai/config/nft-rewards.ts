export const nftRewards = {
  web3Basics: {
    id: 'd3b0cced-5465-4582-a740-c9810b8282a8',
    name: 'Blockchain Basics',
    description:
      'Awarded for completing the Blockchain Basics course, this NFT marks your achievement in understanding the core principles of blockchain technology, from decentralized networks to cryptographic security, on EduLearn.',
    criteria:
      'User must demonstrate comprehensive understanding of: blockchain fundamentals, decentralized networks, cryptographic security, consensus mechanisms, and how blockchain technology works. They should have engaged in multiple meaningful exchanges about these topics and correctly answered questions.',
    requiredTopics: [
      'blockchain',
      'decentralization',
      'consensus',
      'cryptography',
      'nodes',
    ],
  },
  defiFoundations: {
    id: 'd97ced2e-330d-4b62-8777-871ed5d5a5a4',
    name: 'DeFi Foundations',
    description:
      "Proof you've mastered the basics of DeFi—wallets, swaps, and liquidity. A collectible badge of your knowledge and entry into EduLearn perks.",
    criteria:
      'User must show deep understanding of: DeFi protocols, liquidity pools, yield farming, DEXs, lending protocols, AMMs, and DeFi security practices. They should demonstrate practical knowledge through thoughtful questions and correct answers.',
    requiredTopics: ['defi', 'liquidity', 'amm', 'dex', 'yield', 'lending'],
  },
  icm: {
    id: '4c7fc27a-3156-49f7-8ed4-1d3116c7b5ce',
    name: 'ICM',
    description:
      'Awarded for understanding how Solana is transforming global finance with decentralized, internet-native capital markets.',
    criteria:
      "User must demonstrate understanding of: Internet Capital Markets concept, Solana's role in global finance, tokenization of assets, on-chain trading, and how blockchain enables permissionless capital markets. Should show engagement with ICM-specific topics.",
    requiredTopics: [
      'icm',
      'capital markets',
      'solana',
      'tokenization',
      'believe',
    ],
  },
  eduLearnWelcome: {
    id: 'aed65cb8-c7d9-43f0-ad72-d77909bd0972',
    name: 'EduLearner',
    description:
      "Welcome to EduLearn! This Badge celebrates your journey into the world of blockchain education. You've taken the first step towards mastering decentralized technologies and building the future of finance.",
    criteria:
      'Awarded automatically to new users or when they complete their first meaningful learning interaction, showing enthusiasm to learn about Web3 and blockchain technology.',
    requiredTopics: ['welcome', 'introduction', 'getting started'],
  },
  communityGrowth: {
    id: '74237e5c-e4df-4c29-898c-6dd452f4fd95',
    name: 'Community And Growth Role-Play',
    description:
      'Proof you can engage, build, and grow a thriving Web3 community through strategy, storytelling, and real user connection.',
    criteria:
      'User must demonstrate understanding of: Web3 community building strategies, growth hacking in crypto/blockchain spaces, community engagement tactics, storytelling for Web3 projects, user acquisition and retention in decentralized ecosystems, and DAO governance participation. Should show practical knowledge through role-play scenarios and strategic discussions.',
    requiredTopics: [
      'community',
      'community management',
      'growth',
      'dao',
      'engagement',
      'storytelling',
      'web3 marketing',
    ],
  },
  noizLabsAmbassador: {
    id: '7838fd39-2003-4759-b567-40f04ce3b835',
    name: 'NoizLabs Ambassador',
    description:
      'This NFT represents participation in the EduLearn × NoizLabs program. Eligible holders have the opportunity to become NoizLabs ambassadors and join upcoming creator campaigns.',
    criteria:
      'Awarded to users who have completed the EduLearn × NoizLabs program requirements, demonstrated active participation in the ecosystem, and shown readiness to represent and promote the NoizLabs brand as a creator ambassador.',
    requiredTopics: [
      'noizlabs',
      'ambassador',
      'creator',
      'campaign',
      'edulearn',
    ],
  },
  dappFrontendIntegration: {
    id: '85de4248-2e6f-4491-88c6-61902c55fa23',
    name: 'DApp Frontend Integration',
    description:
      'A token of digital synergy, celebrating your understanding of how web interfaces sync with wallets, networks, and on-chain systems.',
    criteria:
      'User must demonstrate understanding of: connecting frontend web interfaces to blockchain networks, wallet integration (e.g. Phantom, MetaMask), Web3.js or ethers.js usage, reading and writing on-chain data from a UI, RPC providers, and handling wallet connection states. Should show engagement through technical questions and practical scenarios.',
    requiredTopics: [
      'dapp',
      'frontend',
      'wallet integration',
      'web3.js',
      'ethers.js',
      'rpc',
      'phantom',
    ],
  },
  ammsLendingMechanics: {
    id: '8672f12d-7e51-4847-b370-353b2bdfe1c1',
    name: 'AMMs & Lending Mechanics',
    description:
      'A mark of your understanding of automated market makers, liquidity flows, and decentralized lending systems powering DeFi.',
    criteria:
      'User must demonstrate deep understanding of: automated market maker mechanics, constant product formula (x*y=k), liquidity provision and impermanent loss, decentralized lending protocols (Aave, Compound), collateralization, liquidation mechanics, and interest rate models. Should correctly engage with technical DeFi concepts.',
    requiredTopics: [
      'amm',
      'liquidity',
      'impermanent loss',
      'lending',
      'collateral',
      'liquidation',
      'aave',
      'compound',
    ],
  },
  blockchainDataQuerying: {
    id: '954d7547-69a4-4319-863a-a2bdcc96a151',
    name: 'Blockchain Data Querying',
    description:
      'A token of analytical power, recognizing your capacity to query, decode, and illuminate the ever-moving world of on-chain activity.',
    criteria:
      'User must demonstrate understanding of: querying on-chain data using tools like The Graph, Dune Analytics, or Solana explorers, reading transaction data and event logs, indexing blockchain events, subgraph creation, and interpreting on-chain metrics. Should show analytical engagement with blockchain data topics.',
    requiredTopics: [
      'the graph',
      'dune',
      'on-chain data',
      'subgraph',
      'indexing',
      'transaction',
      'explorer',
    ],
  },
  web3Explainer: {
    id: 'e312f874-3381-4950-a205-334612fe5a1b',
    name: 'Web3 Explainer',
    description:
      "You've unlocked the power to break down blockchain, wallets, and decentralization into simple ideas. A badge of clarity in a complex digital world.",
    criteria:
      'User must demonstrate the ability to clearly explain Web3 concepts in simple terms: wallets, public/private keys, decentralization, smart contracts, gas fees, and blockchain use cases. Should show they can break down complex topics for a non-technical audience through their interactions.',
    requiredTopics: [
      'wallets',
      'decentralization',
      'smart contracts',
      'gas fees',
      'web3',
      'explainer',
      'keys',
    ],
  },
  smartContractBasics: {
    id: '1eb40bee-50d1-41ed-a6cd-6036afd1156a',
    name: 'Smart Contract Basics',
    description:
      'A mark of foundational wisdom, showing your ability to understand the code-driven rules that power decentralized interactions.',
    criteria:
      'User must demonstrate understanding of: what smart contracts are, how they execute on-chain, Solidity or Rust basics, deployment and interaction patterns, common smart contract use cases (tokens, NFTs, DAOs), and key vulnerabilities to avoid. Should engage meaningfully with smart contract concepts through discussion and Q&A.',
    requiredTopics: [
      'smart contracts',
      'solidity',
      'rust',
      'deployment',
      'abi',
      'bytecode',
      'evm',
    ],
  },
  basicSecurityAwareness: {
    id: '358a72b1-dce3-4e9f-be76-cdb3af4cd734',
    name: 'Basic Security Awareness',
    description:
      'A badge of vigilance, showing your ability to spot risks, protect your wallet, and navigate Web3 safely with smart security habits.',
    criteria:
      'User must demonstrate understanding of: common Web3 scams and phishing attacks, seed phrase and private key security, safe wallet practices, rug pull identification, smart contract audit awareness, and how to verify contracts and transactions before signing. Should show security-conscious thinking through their interactions.',
    requiredTopics: [
      'security',
      'phishing',
      'seed phrase',
      'private key',
      'scam',
      'rug pull',
      'wallet safety',
    ],
  },
  milestone500XP: {
    id: '5e077518-2122-450d-b469-8388175a5a5f',
    name: '500XP Milestone',
    description:
      '500XP Milestone NFT — celebrating your dedication and progress on EduLearn.',
    criteria:
      'Awarded automatically when the user reaches 500 XP on the EduLearn platform, reflecting consistent engagement, learning activity, and progress across courses and interactions.',
    requiredTopics: ['milestone', 'xp', 'progress', '500'],
  },
  web3ProductBasics: {
    id: '6191d2c3-dbe0-4c79-8437-411c5e5f9e27',
    name: 'Web3 Product Basics',
    description:
      'Proof you understand the fundamentals of decentralized apps, smart contracts, and blockchain-powered user experiences.',
    criteria:
      'User must demonstrate understanding of: what makes a product Web3-native, dApp architecture, smart contract interaction from a product perspective, on-chain vs off-chain data decisions, wallet UX patterns, and how blockchain changes product design and user flows. Should show product thinking applied to Web3 contexts.',
    requiredTopics: [
      'dapp',
      'product',
      'smart contracts',
      'ux',
      'wallet',
      'on-chain',
      'web3 product',
    ],
  },
};
