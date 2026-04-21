import { Type } from '@google/genai';

export const geminiScoreUserTool = {
  name: 'scoreUser',
  description:
    'If the user answers a question you previously asked, and the answer is correct or partially correct, call the scoreUser tool to award them a number of points (score) that you think is appropriate for their answer. The point has to be an integer. and between the range of 1-10. After scoring, in your next response, tell the user how many points you awarded them in this format: I have awarded you {score} points for your answer 🎉',
  parameters: {
    type: Type.OBJECT,
    properties: {
      score: {
        type: Type.NUMBER,
        description: 'The score of the user',
      },
    },
    required: ['score'],
  },
};

export const geminiGiveCertificateTool = {
  name: 'giveACertificate',
  description: `Award badges or certificates ONLY when users demonstrate DEEP understanding through multiple meaningful interactions. Standards are HIGH - users must show mastery, not just basic comprehension.

AVAILABLE CERTIFICATES:

1. 'web3Basics' - Blockchain Basics Badge
   Criteria: User demonstrates comprehensive understanding of blockchain fundamentals, decentralized networks, cryptographic security, consensus mechanisms. They must have engaged in multiple exchanges, asked thoughtful questions, and correctly answered your questions about core blockchain concepts.

2. 'defiFoundations' - DeFi Foundations Badge
   Criteria: User shows deep understanding of DeFi protocols, liquidity pools, yield farming, DEXs, lending protocols, AMMs, and DeFi security. They must demonstrate practical knowledge and understand the risks and mechanisms of decentralized finance.

3. 'icm' - Internet Capital Markets Badge
   Criteria: User demonstrates understanding of Internet Capital Markets, Solana's role in global finance, tokenization, on-chain trading, and how blockchain enables permissionless capital markets. Should reference Believe launchpad or ICM concepts specifically.

4. 'eduLearnWelcome' - EduLearn Welcome Badge
   Criteria: Award to new users who complete their first meaningful learning interaction or show genuine enthusiasm to learn about Web3. This is the most accessible certificate for beginners taking their first steps.

5. 'communityGrowth' - Community And Growth Role-Play Badge
   Criteria: User demonstrates understanding of Web3 community building strategies, growth hacking in crypto/blockchain spaces, storytelling for Web3 projects, and user engagement tactics. They should show practical knowledge through role-play scenarios and strategic community discussions.

6. 'noizLabsAmbassador' - NoizLabs Ambassador Badge
   Criteria: User has completed the EduLearn × NoizLabs program requirements and demonstrated active participation in the ecosystem. They should show readiness to represent the NoizLabs brand and engage with creator campaigns.

7. 'dappFrontendIntegration' - DApp Frontend Integration Badge
   Criteria: User demonstrates understanding of connecting frontend interfaces to blockchain networks, wallet integration (Phantom, MetaMask), Web3.js or ethers.js usage, RPC providers, and handling wallet connection states in a dApp context.

8. 'ammsLendingMechanics' - AMMs & Lending Mechanics Badge
   Criteria: User demonstrates deep understanding of automated market maker mechanics, the constant product formula (x*y=k), liquidity provision, impermanent loss, decentralized lending protocols like Aave and Compound, collateralization, and liquidation mechanics.

9. 'blockchainDataQuerying' - Blockchain Data Querying Badge
   Criteria: User demonstrates understanding of querying on-chain data using tools like The Graph, Dune Analytics, or Solana explorers. They should understand transaction data, event logs, subgraph creation, indexing blockchain events, and interpreting on-chain metrics.

10. 'web3Explainer' - Web3 Explainer Badge
    Criteria: User demonstrates the ability to clearly explain Web3 concepts in simple terms — wallets, public/private keys, decentralization, smart contracts, and gas fees. They should show they can break down complex blockchain topics for a non-technical audience.

11. 'smartContractBasics' - Smart Contract Basics Badge
    Criteria: User demonstrates understanding of what smart contracts are, how they execute on-chain, Solidity or Rust basics, deployment patterns, common use cases (tokens, NFTs, DAOs), and key vulnerabilities. They should engage meaningfully with smart contract concepts through discussion and Q&A.

12. 'basicSecurityAwareness' - Basic Security Awareness Badge
    Criteria: User demonstrates understanding of common Web3 scams, phishing attacks, seed phrase and private key security, safe wallet practices, rug pull identification, and how to verify contracts and transactions before signing.

13. 'milestone500XP' - 500XP Milestone Badge
    Criteria: Awarded automatically when the user reaches 500 XP on the EduLearn platform. This reflects consistent engagement, learning activity, and progress across courses and interactions. No specific topic coverage required.

14. 'web3ProductBasics' - Web3 Product Basics Badge
    Criteria: User demonstrates understanding of dApp architecture, smart contract interaction from a product perspective, on-chain vs off-chain data decisions, wallet UX patterns, and how blockchain changes product design and user flows. Should show product thinking applied to Web3 contexts.

STRICT RULES:
- NEVER award certificates for single questions or brief exchanges
- User must demonstrate understanding across MULTIPLE related concepts
- User must have both ASKED thoughtful questions AND ANSWERED your questions correctly
- Look for practical application thinking, not just theoretical knowledge
- Confidence level must be 8+ (scale 1-10) based on conversation depth
- Each certificate can only be awarded once per user
- Quality over speed - it's better to withhold than award prematurely`,
  parameters: {
    type: Type.OBJECT,
    properties: {
      certificate: {
        type: Type.STRING,
        description:
          "The certificate type to award. Choose the ONE that best matches the user's demonstrated knowledge.",
        enum: [
          'web3Basics',
          'defiFoundations',
          'icm',
          'eduLearnWelcome',
          'communityGrowth',
          'noizLabsAmbassador',
          'dappFrontendIntegration',
          'ammsLendingMechanics',
          'blockchainDataQuerying',
          'web3Explainer',
          'smartContractBasics',
          'basicSecurityAwareness',
          'milestone500XP',
          'web3ProductBasics',
        ],
      },
      confidenceLevel: {
        type: Type.NUMBER,
        description:
          'Your confidence (1-10) that the user truly masters this topic. Minimum 8 required. Base this on: conversation depth, correct answers given, thoughtful questions asked, practical understanding shown.',
      },
      reasoning: {
        type: Type.STRING,
        description:
          "Brief explanation of why you're awarding this certificate. What specific knowledge did the user demonstrate? What topics did they master?",
      },
    },
    required: ['certificate', 'confidenceLevel', 'reasoning'],
  },
};

export const geminiCreateRoadmapTool = {
  name: 'createLearningRoadmap',
  description:
    "Create a personalized learning roadmap when the user explicitly requests one. Use this ONLY when the user asks to create a roadmap, learning path, or study plan for a specific topic. The topic should be related to Web3, blockchain, Solana, smart contracts, DeFi, NFTs, or other crypto/tech topics. Examples: 'create a roadmap for Solana development', 'I want a learning path for DeFi', 'make me a study plan for smart contracts'. Do NOT use this for general questions about topics. UNLESS THE USER ASKS FOR A STRUCTURED LEARNING PATH, ROADMAP, OR STUDY PLAN FOR A TOPIC.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      topic: {
        type: Type.STRING,
        description:
          "The specific topic the user wants to learn. Should be clear and focused (e.g., 'Solana Smart Contracts', 'DeFi Fundamentals', 'NFT Development on Ethereum'). Extract this from the user's request.",
      },
      userIntent: {
        type: Type.STRING,
        description:
          'Brief explanation of why you believe the user wants a roadmap based on their message. This helps validate the request.',
      },
    },
    required: ['topic', 'userIntent'],
  },
};

export const geminiCreatePublicQuizTool = {
  name: 'createPublicQuiz',
  description:
    "Create a multiple-choice quiz others can take when the user explicitly asks for a quiz, practice test, or MCQs on a topic (not flashcards, not a roadmap). Saves it as a community quiz. Examples: 'quiz me on Solana rent', 'make a 10-question quiz about PDAs', 'generate a practice test for DeFi lending'.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      topic: {
        type: Type.STRING,
        description:
          'Topic or scope for the quiz (e.g. Solana transaction lifecycle).',
      },
      userIntent: {
        type: Type.STRING,
        description:
          'Brief note on why the user wants this quiz based on their message.',
      },
      quizTitle: {
        type: Type.STRING,
        description:
          'Short title for the quiz listing. Omit if unsure; a title will be generated.',
      },
      questionCount: {
        type: Type.NUMBER,
        description:
          'Number of questions (5–20). Use 10 when the user does not specify.',
      },
    },
    required: ['topic', 'userIntent'],
  },
};

export const geminiCreateFlashcardDeckTool = {
  name: 'createFlashcardDeck',
  description:
    "Create a flashcard deck when the user explicitly asks for flashcards, study cards, memorization cards, or spaced-repetition cards for a topic. Use ONLY when they want a deck to review (not a learning roadmap, not a quiz, and not a general explanation). Examples: 'make flashcards on Solana PDAs', 'generate 10 cards about DeFi lending', 'I need study cards for the account model'.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      topic: {
        type: Type.STRING,
        description:
          "The topic or scope for the deck (e.g. 'Solana account rent and rent exemption').",
      },
      userIntent: {
        type: Type.STRING,
        description:
          'Brief note on why the user wants flashcards based on their message.',
      },
      cardCount: {
        type: Type.NUMBER,
        description:
          'How many cards to generate (5–30). Use 15 when the user does not specify.',
      },
    },
    required: ['topic', 'userIntent'],
  },
};

export const geminiEditRoadmapTool = {
  name: 'editLearningRoadmap',
  description:
    "Edit steps in a learning roadmap when the user requests modifications to a roadmap they just created or are viewing. Use this when the user asks to modify, change, update, or improve specific aspects of a roadmap. Examples: 'make step 2 longer', 'change the first step to focus on basics', 'update all steps to be more advanced', 'modify the roadmap to include more hands-on examples'. The tool allows editing multiple steps at once. You should analyze the current roadmap context from the conversation and determine which steps need editing based on the user's request.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      roadmapId: {
        type: Type.STRING,
        description:
          'The ID of the roadmap being edited. Extract this from the conversation context where the roadmap was just created or mentioned.',
      },
      modifications: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            stepId: {
              type: Type.STRING,
              description: 'The ID of the step to edit.',
            },
            prompt: {
              type: Type.STRING,
              description:
                'The updated prompt for the step. This should be a detailed prompt that will be sent to the AI when the user starts this step.',
            },
            title: {
              type: Type.STRING,
              description: 'The updated title for the step (3-8 words).',
            },
            description: {
              type: Type.STRING,
              description:
                'The updated description of what the user will learn in this step (1-2 sentences).',
            },
            time: {
              type: Type.NUMBER,
              description:
                'The updated time in minutes for this step (typically 5-10 minutes).',
            },
          },
          required: ['stepId', 'prompt', 'title', 'description', 'time'],
        },
        description:
          "Array of step modifications. Include only the steps that need to be changed based on the user's request.",
      },
      changeReason: {
        type: Type.STRING,
        description:
          "Brief explanation of what changes were made and why, based on the user's request.",
      },
    },
    required: ['roadmapId', 'modifications', 'changeReason'],
  },
};

export const GEMINI_TUTOR_FUNCTION_DECLARATIONS = [
  geminiScoreUserTool,
  geminiGiveCertificateTool,
  geminiCreateRoadmapTool,
  geminiCreatePublicQuizTool,
  geminiCreateFlashcardDeckTool,
  geminiEditRoadmapTool,
];
