/**
 * Simulated security decision lab. Every prompt below is invented text. Nothing here asks for, stores or
 * transmits a secret, and no wallet is contacted. Claims are specific to Ethereum-style wallets and cite
 * the ethereum.org security pages listed in SOURCES.
 */
export type Verdict = 'safer' | 'risky' | 'depends';
export type Choice = { id: string; label: string; verdict: Verdict; outcome: string };
export type Scenario = {
  id: string;
  title: string;
  kind: string;
  seen: string[];
  question: string;
  choices: Choice[];
  saferAction: string;
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  safer: 'A safer choice',
  risky: 'A risky choice',
  depends: 'It depends',
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'connect',
    title: 'A site asks to connect',
    kind: 'Connection request',
    seen: [
      'You opened a portfolio tracker yourself, from a link you saved earlier.',
      'Your wallet shows: “tracker.example wants to see your public address and balances.”',
      'There is no “Approve spending” or “Sign” text in the request.',
    ],
    question: 'What do you do?',
    choices: [
      {
        id: 'connect-read',
        label: 'Approve the connection, and read each later request before approving it',
        verdict: 'depends',
        outcome:
          'A connection request on its own shares your public address. It does not move funds. It is reasonable when you chose the site on purpose, but a connected site can later ask for approvals or transactions, and each of those needs its own decision.',
      },
      {
        id: 'connect-reject',
        label: 'Reject it and use the tracker by pasting a public address instead',
        verdict: 'safer',
        outcome:
          'Watching a public address needs no connection at all. Pasting an address shares less than connecting a wallet, so it is a lower-risk way to look around.',
      },
      {
        id: 'connect-blind',
        label: 'Approve it and any follow-up request, since the first one looked harmless',
        verdict: 'risky',
        outcome:
          'The first request being harmless says nothing about the next one. Later requests can ask to spend tokens or send a transaction, so every prompt needs its own read.',
      },
    ],
    saferAction:
      'Connect only to sites you chose yourself, read every prompt as new, and prefer watch-only address entry when you only want to look.',
  },
  {
    id: 'seed',
    title: 'Support asks for your recovery phrase',
    kind: 'Deceptive prompt',
    seen: [
      'A chat window says “Wallet Support” and a problem has been found with your wallet.',
      'It asks you to type your 12 or 24 word recovery phrase into a form to “verify” your account.',
      'A timer says your account will be locked in 10 minutes.',
    ],
    question: 'What do you do?',
    choices: [
      {
        id: 'seed-type',
        label: 'Type the phrase quickly so the account is not locked',
        verdict: 'risky',
        outcome:
          'Anyone who has your recovery phrase can take everything in the wallet, and moving crypto out cannot be undone by support. Real services do not ask for it. Urgency is a pressure tactic.',
      },
      {
        id: 'seed-part',
        label: 'Type only a few of the words to check whether it is real',
        verdict: 'risky',
        outcome:
          'Partial phrases can still help an attacker, and typing any of it into a stranger’s form is the mistake. Do not enter any part.',
      },
      {
        id: 'seed-leave',
        label: 'Close it, tell no one the phrase, and open your wallet app from your own bookmark',
        verdict: 'safer',
        outcome:
          'No legitimate service, support agent or website will ask for your recovery phrase or private keys. Leaving, then checking your wallet through a route you chose, is the right move.',
      },
    ],
    saferAction:
      'Never type your recovery phrase or private keys into a website, chat or form. There is no official support that needs them. Ignore countdown timers.',
  },
  {
    id: 'allowance',
    title: 'An unlimited spending approval',
    kind: 'Token approval',
    seen: [
      'You are swapping a token on a new, unfamiliar site.',
      'Your wallet shows an approval for “unlimited” spending of that token by the site’s contract.',
      'The site says this saves you from approving again later.',
    ],
    question: 'What do you do?',
    choices: [
      {
        id: 'allow-unlimited',
        label: 'Approve unlimited so you never have to approve again',
        verdict: 'risky',
        outcome:
          'An unlimited approval lets that contract move all of that token from the wallet, now and later, until you revoke it. Approvals do not expire on their own, and disconnecting the site does not remove them.',
      },
      {
        id: 'allow-exact',
        label: 'Edit the amount down to what this swap needs, if your wallet allows it',
        verdict: 'safer',
        outcome:
          'Limiting the approval to the amount you need cuts the risk. Some wallets let you set a custom amount. You may pay the approval fee again next time, which is the trade for lower exposure.',
      },
      {
        id: 'allow-reject',
        label: 'Reject it, and leave a site you do not know',
        verdict: 'safer',
        outcome:
          'Skipping an unfamiliar project is a valid answer. Untested projects are one of the risks that ethereum.org names for approvals.',
      },
    ],
    saferAction:
      'Approve only what you need, avoid unlimited approvals on unproven sites, and review and revoke old approvals from time to time. Revoking also costs a network fee.',
  },
  {
    id: 'domain',
    title: 'A giveaway link with a strange web address',
    kind: 'Suspicious domain',
    seen: [
      'A social post promises free tokens for the first 500 people to “connect and claim”.',
      'The link goes to a site whose address is close to a well-known project, but spelled slightly differently.',
      'The page looks like the real one and asks you to connect your wallet.',
    ],
    question: 'What do you do?',
    choices: [
      {
        id: 'domain-claim',
        label: 'Connect and claim quickly, because the page looks right',
        verdict: 'risky',
        outcome:
          'Copying a real site’s look is easy. Lookalike addresses and limited-time giveaways are common phishing patterns. Connecting can lead to a harmful approval prompt.',
      },
      {
        id: 'domain-check',
        label: 'Do not use the link. Go to the project from a bookmark or its official channels',
        verdict: 'safer',
        outcome:
          'If an offer is real, it can be found through a source you already trust. A link in an ad or message is not a reason to connect a wallet.',
      },
      {
        id: 'domain-small',
        label: 'Connect with a wallet that holds very little, just to see',
        verdict: 'depends',
        outcome:
          'A near-empty wallet limits what can be taken, but the site can still learn and log your address, and you may build a habit of connecting to unknown sites. It is better not to connect at all.',
      },
    ],
    saferAction:
      'Treat giveaways with deadlines and look-alike addresses as suspect. Reach projects from bookmarks or official channels, not from links in ads or messages.',
  },
];

export const SOURCES = [
  { label: 'ethereum.org: security and scam prevention', href: 'https://ethereum.org/security/' },
  {
    label: 'ethereum.org: how to revoke smart contract access',
    href: 'https://ethereum.org/guides/how-to-revoke-token-access/',
  },
];
