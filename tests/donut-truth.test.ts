import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Donut } from '../features/portfolio/donut';
import { assetAllocation, fmtPercent, networkAllocation } from '../features/portfolio/model';
import type { Position } from '../features/portfolio/model';

const C = 2 * Math.PI * 42;

const dashes = (html: string) =>
  [...html.matchAll(/stroke-dasharray="([0-9.e-]+) /g)].map((m) => Number(m[1]));

it('a true 0.1% slice keeps its true arc - the separator gap is omitted, never subtracted to nothing', () => {
  const html = renderToStaticMarkup(
    createElement(Donut, {
      caption: 'chains',
      slices: [
        { label: 'Ethereum', percent: 99.9, color: '#627eea' },
        { label: 'Solana', percent: 0.1, color: '#9945ff' },
      ],
    }),
  );
  const d = dashes(html);
  // True arcs: 99.9% of C minus the hairline gap; 0.1% of C intact (0.264px, smaller than the gap).
  expect(d[0]).toBeCloseTo(0.999 * C - 0.6, 3);
  expect(d[1]).toBeCloseTo(0.001 * C, 6);
  expect(d[1]).toBeGreaterThan(0);
  expect(html).toContain('Allocation: Ethereum 99.9 percent, Solana 0.1 percent');
});

it('a sub-0.1% slice reads <0.1 in the donut aria and never 0', () => {
  const html = renderToStaticMarkup(
    createElement(Donut, {
      caption: 'chains',
      slices: [
        { label: 'Ethereum', percent: 100, color: '#627eea' },
        { label: 'Solana', percent: 0, color: '#9945ff', roundedZero: true },
      ],
    }),
  );
  expect(html).toContain('Solana &lt;0.1 percent');
  expect(html).not.toContain('Solana 0 percent');
});

it('a sub-0.05% slice keeps its RAW-RATIO arc - geometry never collapses to zero from rounded display', () => {
  const html = renderToStaticMarkup(
    createElement(Donut, {
      caption: 'chains',
      slices: [
        { label: 'Ethereum', percent: 100, share: 0.9996, color: '#627eea' },
        { label: 'Solana', percent: 0, share: 0.0004, roundedZero: true, color: '#9945ff' },
      ],
    }),
  );
  const d = dashes(html);
  expect(d[1]).toBeCloseTo(0.0004 * C, 6); // 0.106px true arc, not 0
  expect(d[1]).toBeGreaterThan(0);
  expect(d[0]).toBeCloseTo(0.9996 * C - 0.6, 3);
  expect(html).toContain('Solana &lt;0.1 percent');
});

const pos = (over: Partial<Position>): Position => ({
  id: 'p',
  exposureId: 'e',
  assetId: 'eip155:1/native',
  symbol: 'X',
  network: 'Ethereum',
  kind: 'Wallet',
  quantity: '1',
  valueCents: 0n,
  ...over,
});

it('model: a true nonzero share below 0.05% keeps percent 0 plus roundedZero, displayed as <0.1', () => {
  const big = pos({ valueCents: 1_000_000_000n, assetId: 'eip155:1/native' });
  const dust = pos({ id: 'd', exposureId: 'e2', symbol: 'D', assetId: 'eip155:1/erc20:0xabc', valueCents: 399_999n }); // 0.04%
  const rows = assetAllocation([big, dust]);
  const d = rows.find((r) => r.symbol === 'D')!;
  expect(d.percent).toBe(0); // rounded to 0.1 - the raw truth is preserved by the flag
  expect(d.roundedZero).toBe(true);
  expect(d.share).toBeCloseTo(0.0004, 6); // raw ratio survives for geometry
  expect(fmtPercent(d.percent, d.roundedZero)).toBe('<0.1');
  expect(fmtPercent(58.3, false)).toBe('58.3');
  expect(fmtPercent(0, false)).toBe('0'); // a truly zero value still reads 0
  const nets = networkAllocation([pos({ valueCents: 1_000_000_000n }), { ...dust, network: 'Solana' } as Position]);
  expect(nets.find((n) => n.network === 'Solana')?.roundedZero).toBe(true);
});
