export type LessonSection =
  | 'Start Here'
  | 'Fundamentals'
  | 'Wallets & Networks'
  | 'DeFi Strategies'
  | 'Risk & Security';

export type Lesson = {
  id: string;
  /** The plan §8 learning-shell section this module belongs to (drives /learn grouping). */
  section: LessonSection;
  path: string;
  title: string;
  eyebrow: string;
  summary: string;
  sections: { title: string; body: string }[];
  question: string;
  answers: string[];
  correct: number;
  explanation: string;
};
export const lessons: Lesson[] = [
  {
    id: 'basics',
    section: 'Start Here',
    path: '/learn/start-here',
    title: 'A clearer view of DeFi.',
    eyebrow: '01 / BLOCKCHAIN BASICS',
    summary: 'Start with the ideas. No wallet, account, or funds needed.',
    sections: [
      {
        title: 'A shared record',
        body: 'A blockchain records activity across a network. A wallet is a tool for interacting with that record; it does not hold coins like a physical purse.',
      },
      {
        title: 'Finance through code',
        body: 'Decentralized finance uses smart contracts for activities such as lending and exchanging tokens. Code, governance, and economic incentives can all fail.',
      },
      {
        title: 'Observation comes first',
        body: 'Sola Lens is a learning preview. Demo portfolios are invented examples, always labeled as simulations. You can explore without installing anything.',
      },
    ],
    question: 'What do you need to explore this preview?',
    answers: ['A funded wallet', 'Nothing — just curiosity', 'A recovery phrase'],
    correct: 1,
    explanation: 'You can learn and explore the demo without a wallet or funds.',
  },
  {
    id: 'wallets',
    section: 'Wallets & Networks',
    path: '/learn/wallets',
    title: 'Choose how to hold your keys.',
    eyebrow: '02 / WALLET GUIDE',
    summary: 'Understand the two layers before comparing any product.',
    sections: [
      {
        title: 'The interface',
        body: 'Software wallets provide a browser or app interface. MetaMask and NuFi are candidates to research, not Sola endorsements.',
      },
      {
        title: 'The key storage',
        body: 'Hardware devices keep keys on a separate device. OneKey and Ledger offer hardware products. A software interface may work with hardware; verify the exact device, network, browser, and version first.',
      },
      {
        title: 'There is no purchase requirement',
        body: 'Learning does not require buying a device. Hardware does not eliminate phishing, recovery-backup risks, or the need to understand what you approve.',
      },
    ],
    question: 'Can software interfaces and hardware key storage work together?',
    answers: [
      'Yes, when that exact combination is supported',
      'No, they are always alternatives',
      'Yes, every device works with every app',
    ],
    correct: 0,
    explanation:
      'The interface and key storage are different layers. Compatibility needs verification for the exact setup.',
  },
  {
    id: 'security',
    section: 'Risk & Security',
    path: '/learn/security',
    title: 'Build your security habits.',
    eyebrow: '03 / SECURITY FIRST',
    summary: 'Pause before you trust. A familiar logo is not proof of safety.',
    sections: [
      {
        title: 'Keep recovery material private',
        body: 'Never share a recovery phrase, private key, or passphrase with a website or support agent. Sola never asks for them. Keep recovery backups offline and protected.',
      },
      {
        title: 'Spot phishing',
        body: 'Check the full domain, avoid unsolicited links, and use a trusted bookmark. Urgent messages and promises of free tokens are warning signs.',
      },
      {
        title: 'Connection is not signing',
        body: 'Account discovery exposes public information; signing authorizes a message or action. Token approvals can grant spending permissions. Read each request; disconnecting alone does not revoke approvals.',
      },
      {
        title: 'Public does not mean private',
        body: 'Addresses and activity can be linked to an identity. A real lookup on Track sends the address you paste to the lookup service and a public node, as Track discloses before you run it; nothing is saved unless you explicitly save it there. This education exercise sends nothing.',
      },
    ],
    question: 'A support message asks you to enter your recovery phrase. What should you do?',
    answers: ['Enter it to verify the account', 'Share only half', 'Stop and leave the site'],
    correct: 2,
    explanation:
      'Do not share any recovery words. Legitimate support does not need your recovery phrase.',
  },
  {
    id: 'addresses',
    section: 'Fundamentals',
    path: '/learn/addresses',
    title: 'Read a portfolio with context.',
    eyebrow: '04 / ADDRESSES & NETWORKS',
    summary: 'An address identifies activity. It does not prove ownership.',
    sections: [
      {
        title: 'Always name the network',
        body: 'Ethereum and Solana use different account models and address formats. Even an identical-looking address on two EVM networks can have different balances.',
      },
      {
        title: 'Separate assets and obligations',
        body: 'Wallet assets, supplied collateral, borrowed debt, and liquidity positions have different meanings. Debt reduces net value; a receipt token must not be added again to the exposure it represents.',
      },
      {
        title: 'Unknown is not zero',
        body: 'Missing prices, stale observations, and unsupported positions make totals incomplete. A balance view is not a tax report, cost basis, or proof of ownership.',
      },
    ],
    question: 'A token has no available price. How should its value appear?',
    answers: ['$0', 'Unknown; totals are incomplete', 'The last number you remember'],
    correct: 1,
    explanation:
      'Missing information must stay visible. Treating unknown value as zero makes an incomplete total look complete.',
  },
  {
    id: 'defi',
    section: 'DeFi Strategies',
    path: '/learn/defi-strategies',
    title: 'Explore a swap, safely.',
    eyebrow: '05 / SOLANA & SWAP EDUCATION',
    summary: 'An interactive example of a Solana swap workflow. No transaction takes place.',
    sections: [
      {
        title: 'From one asset to another',
        body: 'Swap interfaces such as Jupiter on Solana help users exchange tokens. A quote is an estimate; route, fees, price impact, and slippage matter.',
      },
      {
        title: 'Review the trade-offs',
        body: 'Slippage tolerance limits an acceptable execution difference; it is not a fee or a guarantee. Network costs and a changing market can affect the result.',
      },
      {
        title: 'Know when to stop',
        body: 'A real swap would involve permissions and signing outside this preview. Here you only step through invented review screens. No tokens move.',
      },
    ],
    question: 'Does an estimated quote guarantee the final result?',
    answers: [
      'Yes',
      'Only if the interface looks familiar',
      'No — execution conditions can change',
    ],
    correct: 2,
    explanation:
      'A quote is an estimate. Fees, price impact, slippage, and market changes all need review.',
  },
  {
    id: 'risks',
    section: 'DeFi Strategies',
    path: '/learn/lending-and-risk',
    title: 'Look beyond the yield.',
    eyebrow: '06 / LENDING, STAKING & LIQUIDITY',
    summary: 'Different positions bring different ways to lose value.',
    sections: [
      {
        title: 'Lending and borrowing',
        body: 'Lenders face contract and liquidity risks. Borrowers can be liquidated when collateral falls or debt rises. A health factor is meaningful only with its protocol definition and a reliable observation.',
      },
      {
        title: 'Staking',
        body: 'Rewards vary. Validator performance, lockups, withdrawal delays, and network-specific penalties can affect a position. Liquid staking also adds token and contract risks.',
      },
      {
        title: 'Liquidity pools',
        body: 'Pool assets can change in proportion as prices move. Divergence loss, contract failures, and withdrawal constraints can outweigh fees. Receipt tokens represent an underlying position, not extra wealth.',
      },
    ],
    question: 'What does a high advertised yield tell you about safety?',
    answers: [
      'It guarantees a good outcome',
      'It does not establish safety',
      'It eliminates contract risk',
    ],
    correct: 1,
    explanation:
      'Yield is not a safety rating. Understand the source of returns and the potential losses.',
  },
];
export function getLesson(id: string) {
  const lesson = lessons.find((item) => item.id === id);
  if (!lesson) throw new Error('Unknown lesson');
  return lesson;
}
