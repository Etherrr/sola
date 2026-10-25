/**
 * Aave V3 position read composition. Dependency-injected: the rpcCall argument owns the
 * network; this module never fetches by itself. Any failure or non-canonical payload is an
 * honest unavailable state - never zero, never substituted. Aave market-reference prices are
 * decoded for validation only and are dropped here: values are priced exclusively by the
 * app's own verified Chainlink feed layer, so every position leaves this module with a null
 * value until that layer prices it. A position's observation time is the reserve's stored
 * lastUpdateTimestamp (the index used for its balances), not the fetch time.
 */
import {
  decodeGetReservesData,
  decodeGetUserReservesData,
  encodeGetReservesData,
  encodeGetUserReservesData,
  currentSupplied,
  currentVariableDebt,
  type ReserveData,
} from './aave-v3';

export type RpcFailure = 'timeout' | 'unavailable' | 'rate_limited' | 'bad_response';
export type RpcCall = (
  to: string,
  data: string,
) => Promise<{ ok: true; result: string } | { ok: false; reason: RpcFailure }>;

export type AavePosition = {
  underlyingAsset: string;
  symbol: string;
  decimals: number;
  suppliedRaw: bigint;
  variableDebtRaw: bigint;
  usageAsCollateralEnabled: boolean;
  reserveFlags: { isActive: boolean; isFrozen: boolean; isPaused: boolean };
  aTokenAddress: string;
  variableDebtTokenAddress: string;
  /** Stored-index observation time (reserve lastUpdateTimestamp), seconds since epoch. */
  observedAt: bigint;
  /** Always null here: only the app's verified feed layer may price a position. */
  valueUsd: null;
};

export type AavePositionsRead =
  | { kind: 'ok'; positions: AavePosition[] }
  | { kind: 'unavailable'; reason: RpcFailure | 'bad_payload' };

export async function readAaveV3Positions(
  rpcCall: RpcCall,
  addresses: { poolAddressesProvider: string; uiPoolDataProvider: string; user: string },
): Promise<AavePositionsRead> {
  const [reservesRes, userRes] = await Promise.all([
    rpcCall(
      addresses.uiPoolDataProvider,
      encodeGetReservesData(addresses.poolAddressesProvider),
    ),
    rpcCall(
      addresses.uiPoolDataProvider,
      encodeGetUserReservesData(addresses.poolAddressesProvider, addresses.user),
    ),
  ]);
  if (!reservesRes.ok) return { kind: 'unavailable', reason: reservesRes.reason };
  if (!userRes.ok) return { kind: 'unavailable', reason: userRes.reason };
  const reservesDecoded = decodeGetReservesData(reservesRes.result);
  const userDecoded = decodeGetUserReservesData(userRes.result);
  if (reservesDecoded === null || userDecoded === null)
    return { kind: 'unavailable', reason: 'bad_payload' };
  const byAsset = new Map<string, ReserveData>(
    reservesDecoded.reserves.map((r) => [r.underlyingAsset, r]),
  );
  const positions: AavePosition[] = [];
  for (const u of userDecoded.userReserves) {
    if (u.scaledATokenBalance === 0n && u.scaledVariableDebt === 0n) continue;
    const r = byAsset.get(u.underlyingAsset);
    if (r === undefined) return { kind: 'unavailable', reason: 'bad_payload' }; // user position in an unknown reserve: never guess
    positions.push({
      underlyingAsset: u.underlyingAsset,
      symbol: r.symbol,
      decimals: r.decimals,
      suppliedRaw: currentSupplied(u.scaledATokenBalance, r.liquidityIndex),
      variableDebtRaw: currentVariableDebt(u.scaledVariableDebt, r.variableBorrowIndex),
      usageAsCollateralEnabled: u.usageAsCollateralEnabled,
      reserveFlags: { isActive: r.isActive, isFrozen: r.isFrozen, isPaused: r.isPaused },
      aTokenAddress: r.aTokenAddress,
      variableDebtTokenAddress: r.variableDebtTokenAddress,
      observedAt: r.lastUpdateTimestamp,
      valueUsd: null,
    });
  }
  return { kind: 'ok', positions };
}
