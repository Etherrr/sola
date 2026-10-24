import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('copy never claims a wallet is empty when the read failed', () => {
  it.each(['server/portfolio/provider.ts', 'features/portfolio/track-form.tsx'])(
    '%s has no categorical "not an empty wallet" claim',
    (f) => {
      expect(readFileSync(f, 'utf8')).not.toMatch(/not an empty wallet/i);
    },
  );
});

describe('network-specific result copy never names the wrong chain', () => {
  const form = readFileSync('features/portfolio/track-form.tsx', 'utf8');
  it('the Solana result privacy line sends the address to a Solana node, never an Ethereum one', () => {
    expect(form).toContain('this lookup sent the address to a public Solana node (PublicNode)');
    // The old single-network wording claimed the address went to an Ethereum node; that claim
    // must not survive in any Solana branch. The Solana line may name Ethereum only as the
    // chain hosting the SOL/USD price feed.
    const solLine = form.match(/sent the address to a public Solana node[^"]*"/);
    expect(solLine).not.toBeNull();
    expect(solLine![0]).not.toContain('sent the address to a public Ethereum node');
    expect(solLine![0]).toContain('SOL/USD price feed through a public Ethereum node');
  });
  it('the Ethereum result privacy line sends the address to an Ethereum node, never a Solana one', () => {
    const ethLine = form.match(/sent the address to a public Ethereum node[^"]*"/);
    expect(ethLine).not.toBeNull();
    expect(ethLine![0]).not.toContain('Solana node');
  });
  it('the Solana provider reports a Solana slot and an Ethereum-mainnet feed, never an "Ethereum block" read', () => {
    const prov = readFileSync('server/portfolio/live-provider-solana.ts', 'utf8');
    expect(prov).toContain('Balances were read together at Solana slot');
    expect(prov).toContain('Chainlink SOL/USD feed on Ethereum mainnet');
    expect(prov).not.toMatch(/Ethereum block \$\{/);
  });
  it('the Solana API warning keeps the SPL/NFT/DeFi coverage limit explicit', () => {
    const handler = readFileSync('server/portfolio/handler.ts', 'utf8');
    expect(handler).toContain('Only the SOL balance is checked');
    expect(handler).toContain('A missing token is not a zero balance');
  });
});

describe('the top-bar network selector never contradicts the track selection', () => {
  const sel = readFileSync('components/chain-selector.tsx', 'utf8');
  const form = readFileSync('features/portfolio/track-form.tsx', 'utf8');
  const shell = readFileSync('components/app-shell.tsx', 'utf8');
  it('offers only networks the lookup actually reads, with no disabled placeholders', () => {
    expect(sel).not.toMatch(/not supported yet/);
    expect(sel).not.toMatch(/disabled/);
    expect(sel).toContain("id: 'ethereum'");
    expect(sel).toContain("label: 'Solana (SOL only)'");
    // Base and Arbitrum were listed as disabled options; they must not return silently.
    expect(sel).not.toMatch(/Base|Arbitrum/);
  });
  it('is bound to the shared track network state, never frozen on Ethereum', () => {
    expect(sel).not.toMatch(/value="ethereum"/);
    expect(sel).not.toMatch(/onChange={\(\) => undefined}/);
    expect(sel).toContain('useTrackNetwork');
  });
  it('the form reads the same shared state, so the two controls cannot diverge', () => {
    expect(form).toContain('useTrackNetwork');
    expect(form).not.toMatch(/useState<TrackNetwork>/);
    expect(shell).toContain('TrackNetworkProvider');
  });
});

describe('the DeFi app carries no education traces beyond one button to the separate area', () => {
  const shell = readFileSync('components/app-shell.tsx', 'utf8');
  const track = readFileSync('app/track/page.tsx', 'utf8');
  it('the sidebar keeps a single Education link and drops Learn, Start and Explore', () => {
    expect(shell).toContain("href: '/education'");
    expect(shell).not.toMatch(/href: '\/(learn|start|explore)'/);
    expect((shell.match(/\/education/g) || []).length).toBe(1);
  });
  it('the app footer no longer frames the whole app as a learning preview', () => {
    expect(shell).not.toMatch(/Learning preview/);
    expect(shell).not.toMatch(/Educational information only/);
    expect(shell).toMatch(/Read-only/);
  });
  it('Track drops the demo and learn CTAs', () => {
    expect(track).not.toMatch(/Explore the demo/);
    expect(track).not.toMatch(/Learn DeFi/);
    expect(track).not.toMatch(/ActionLink/);
  });
});

describe('the entrance is truthful about live lookups and welcomes the verified account', () => {
  const entrance = readFileSync('components/entrance.tsx', 'utf8');
  it('drops the stale all-simulated claims', () => {
    expect(entrance).not.toMatch(/Everything here is simulated/);
    expect(entrance).not.toMatch(/no live balances yet/i);
    expect(entrance).not.toMatch(/◇ SIMULATED/);
    expect(entrance).toMatch(/◇ READ-ONLY/);
  });
  it('describes the live read-only lookup without overstating coverage', () => {
    expect(entrance).toMatch(/live public balances/);
    expect(entrance).toMatch(/clearly labeled sample/);
    expect(entrance).toMatch(/No wallet connection/);
  });
  it('greets only the verified session email, never a guessed name', () => {
    expect(entrance).toContain('useSession');
    expect(entrance).toContain("session.kind === 'verified'");
    expect(entrance).not.toMatch(/Bill|bill\.|Master/);
  });
});
