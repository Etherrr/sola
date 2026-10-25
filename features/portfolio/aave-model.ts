import type { ApiAavePosition } from './api-client';
import type { Position } from './model';

/** USD decimal string (up to 6 fractional digits, as the API emits) -> exact cents, truncated
 *  toward zero past the second digit so a total never overstates. Null when unpriced or when
 *  the string is not a decimal at all: an unparseable value is unknown, never zero. */
export function usdToCents(value: string | null): bigint | null {
  if (value === null) return null;
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (!m) return null;
  const whole = BigInt(m[1]!);
  const frac = (m[2] ?? '').padEnd(2, '0').slice(0, 2);
  return whole * 100n + BigInt(frac);
}

/**
 * Aave V3 positions as aggregate-model rows: Supplied and Debt kinds only. Receipt (aToken) and
 * debt-token addresses never become rows - the server excludes them and this adapter adds none,
 * so a position is never double-counted as its own receipt token. A reserve's supplied side and
 * debt side get distinct exposureIds so uniqueExposures cannot drop the debt row, and the debt
 * direction travels in kind (values stay nonnegative), which summarize() counts as debt.
 */
export function aaveToPositions(
  positions: readonly ApiAavePosition[],
  wallet: string,
): Position[] {
  const out: Position[] = [];
  for (const p of positions) {
    const asset = p.underlyingAsset.toLowerCase();
    const exposureId = `aave-v3:eip155:1:${asset}`;
    const assetId = `eip155:1/erc20:${asset}`;
    const owner = wallet.toLowerCase();
    if (p.supplied !== '0')
      out.push({
        id: `${exposureId}:supplied:${owner}`,
        exposureId,
        assetId,
        symbol: p.symbol,
        network: 'Ethereum',
        kind: 'Supplied',
        quantity: p.supplied,
        valueCents: usdToCents(p.suppliedValueUsd),
      });
    if (p.variableDebt !== '0')
      out.push({
        id: `${exposureId}:debt:${owner}`,
        exposureId: `${exposureId}:debt`,
        assetId,
        symbol: p.symbol,
        network: 'Ethereum',
        kind: 'Debt',
        quantity: p.variableDebt,
        valueCents: usdToCents(p.variableDebtValueUsd),
      });
  }
  return out;
}
