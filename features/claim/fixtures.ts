/**
 * SYNTHETIC fixtures for the claim panel dev preview (app/dev/claim). Invented
 * addresses only - never a real user row. Each case scripts one ClaimApi.
 */
import type { ClaimApi, ClaimReportRow } from './claim-api';

const T0 = '2026-10-26T07:00:00.000Z';

const LEG = [
  { network: 'ethereum', address: '0x1111111111111111111111111111111111111111', label: 'Ledger' },
  { network: 'ethereum', address: '0x2222222222222222222222222222222222222222', label: 'CEX' },
  { network: 'solana', address: 'SoL11111111111111111111111111111111', label: 'Hot' },
];
const LIVE_DUP = { network: 'ethereum', address: '0x3333333333333333333333333333333333333333', label: 'Old name' };
const TOMB_DUP = { network: 'solana', address: 'SoL22222222222222222222222222222222', label: 'Removed here' };

const reportRows = (rows: { network: string; address: string }[], disposition: ClaimReportRow['disposition']) =>
  rows.map((r) => ({ ...r, disposition }));

/** Happy path with every preview set present: 3 to copy, 1 live dup, 1 tombstone dup. */
export function fixtureHappy(): ClaimApi {
  const attemptId = 'fx-attempt-1';
  const report: ClaimReportRow[] = [
    ...reportRows(LEG, 'copied'),
    ...reportRows([LIVE_DUP], 'skipped_live_dup'),
    ...reportRows([TOMB_DUP], 'skipped_tombstone_dup'),
  ];
  return {
    async preview() {
      return {
        status: 200,
        body: {
          advisory: true as const,
          alreadyClaimed: false,
          activeAttemptId: null,
          toCopy: LEG,
          liveDuplicates: [LIVE_DUP],
          tombstoneDuplicates: [TOMB_DUP],
          mergedCount: { ethereum: 3, solana: 2 },
        },
      };
    },
    async attempt() {
      return { status: 200, body: { attemptId, report } };
    },
    async report() {
      return { status: 200, body: { attemptId, state: 'claimed' as const, createdAt: T0, rolledBackAt: null, report } };
    },
    async rollback() {
      return { status: 200, body: { attemptId, state: 'rolled_back', report } };
    },
  };
}

/** Attempt refused: the merged list would exceed the per-network cap. */
export function fixtureCap(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async attempt() {
      return {
        status: 409,
        body: { error: { code: 'cap_exceeded' }, mergedCount: { ethereum: 6, solana: 1 } },
      };
    },
  };
}

/** Rollback fail-closed: one copied row was renamed after the move (offender). */
export function fixtureBlockedRollback(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async rollback() {
      return {
        status: 409,
        body: {
          error: { code: 'rollback_blocked' },
          offenders: [{ network: 'ethereum', address: LEG[1].address }],
          remedy: 'reconcile_or_remove',
        },
      };
    },
  };
}

/** Nothing to move: no legacy rows under the old sign-in. */
export function fixtureEmpty(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async preview() {
      return {
        status: 200,
        body: {
          advisory: true as const,
          alreadyClaimed: false,
          activeAttemptId: null,
          toCopy: [],
          liveDuplicates: [],
          tombstoneDuplicates: [],
          mergedCount: { ethereum: 0, solana: 0 },
        },
      };
    },
    async attempt() {
      return { status: 409, body: { error: { code: 'no_legacy_rows' } } };
    },
  };
}

/** Returning owner: an active claim belonging to THIS account exists. */
export function fixtureReturningClaimed(): ClaimApi {
  const base = fixtureHappy();
  const attemptId = 'fx-attempt-1';
  const report: ClaimReportRow[] = [
    ...reportRows(LEG, 'copied'),
    ...reportRows([LIVE_DUP], 'skipped_live_dup'),
    ...reportRows([TOMB_DUP], 'skipped_tombstone_dup'),
  ];
  return {
    ...base,
    async preview() {
      return {
        status: 200,
        body: {
          advisory: true as const,
          alreadyClaimed: true,
          activeAttemptId: attemptId,
          toCopy: [],
          liveDuplicates: [],
          tombstoneDuplicates: [],
          mergedCount: { ethereum: 3, solana: 2 },
        },
      };
    },
    async report() {
      return { status: 200, body: { attemptId, state: 'claimed' as const, createdAt: T0, rolledBackAt: null, report } };
    },
    async rollback() {
      return { status: 200, body: { attemptId, state: 'rolled_back', report } };
    },
  };
}

/** Claimed under another account: no attempt id disclosed, no recovery. */
export function fixtureClaimedElsewhere(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async preview() {
      return {
        status: 200,
        body: {
          advisory: true as const,
          alreadyClaimed: true,
          activeAttemptId: null,
          toCopy: LEG,
          liveDuplicates: [LIVE_DUP],
          tombstoneDuplicates: [TOMB_DUP],
          mergedCount: { ethereum: 3, solana: 2 },
        },
      };
    },
  };
}

/** Returning owner whose report cannot be loaded (500 on the report read). */
export function fixtureRecoveryFailed(): ClaimApi {
  const base = fixtureReturningClaimed();
  return {
    ...base,
    async report() {
      return { status: 500, body: { error: { code: 'report_failed' } } };
    },
  };
}

/** Transport dies on the attempt: the answer never arrives. */
export function fixtureMoveUnknown(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async attempt() {
      throw new TypeError('fetch failed');
    },
  };
}

/** Post-commit read failure shape: 200 with an unusable body. */
export function fixtureMoveMalformed(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async attempt() {
      return { status: 200, body: {} };
    },
  };
}

/** 500 on rollback: the undo's outcome is unknown. */
export function fixtureUndoUnknown(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async rollback() {
      return { status: 500, body: { error: { code: 'rollback_failed' } } };
    },
  };
}

/** The undo's answer was lost earlier and it DID complete: 409 already_rolled_back. */
export function fixtureAlreadyRolledBack(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async rollback() {
      return { status: 409, body: { error: { code: 'already_rolled_back' } } };
    },
  };
}

/** D3 regression: the undo's answer was lost but the undo DID commit - Check
 *  status discovers the rolled-back state through the known attempt id. */
export function fixtureUndoLostCommit(): ClaimApi {
  const base = fixtureHappy();
  const attemptId = 'fx-attempt-1';
  const report: ClaimReportRow[] = [
    ...reportRows(LEG, 'copied'),
    ...reportRows([LIVE_DUP], 'skipped_live_dup'),
    ...reportRows([TOMB_DUP], 'skipped_tombstone_dup'),
  ];
  return {
    ...base,
    async rollback() {
      throw new TypeError('fetch failed');
    },
    async report() {
      return {
        status: 200,
        body: { attemptId, state: 'rolled_back' as const, createdAt: T0, rolledBackAt: T0, report },
      };
    },
  };
}

/** D3 regression: 500 on rollback, and the status read shows the undo did NOT
 *  complete - Check status returns to the claimed view with a working undo. */
export function fixtureUndoStatusClaimed(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async rollback() {
      return { status: 500, body: { error: { code: 'rollback_failed' } } };
    },
    // report() from fixtureHappy already answers state 'claimed'
  };
}

/** D3 regression: 500 on rollback AND the status read fails - remain UNKNOWN. */
export function fixtureUndoStatusReadFails(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async rollback() {
      return { status: 500, body: { error: { code: 'rollback_failed' } } };
    },
    async report() {
      return { status: 500, body: { error: { code: 'report_failed' } } };
    },
  };
}

/** Attempt rejected 409 already_claimed: neutral copy, confirmed no-change. */
export function fixtureMoveAlreadyClaimed(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async attempt() {
      return { status: 409, body: { error: { code: 'already_claimed' } } };
    },
  };
}

/** D4: a 503 'disabled' answer is NOT a proved no-change - renders UNKNOWN. */
export function fixtureMoveDisabled(): ClaimApi {
  const base = fixtureHappy();
  return {
    ...base,
    async attempt() {
      return { status: 503, body: { error: { code: 'disabled' } } };
    },
  };
}

export const FIXTURES = {
  happy: fixtureHappy,
  cap: fixtureCap,
  'blocked-rollback': fixtureBlockedRollback,
  empty: fixtureEmpty,
  'returning-claimed': fixtureReturningClaimed,
  'claimed-elsewhere': fixtureClaimedElsewhere,
  'recovery-failed': fixtureRecoveryFailed,
  'move-unknown': fixtureMoveUnknown,
  'move-malformed': fixtureMoveMalformed,
  'undo-unknown': fixtureUndoUnknown,
  'already-rolled-back': fixtureAlreadyRolledBack,
  'undo-lost-commit': fixtureUndoLostCommit,
  'undo-status-claimed': fixtureUndoStatusClaimed,
  'undo-status-read-fails': fixtureUndoStatusReadFails,
  'move-disabled': fixtureMoveDisabled,
  'move-already-claimed': fixtureMoveAlreadyClaimed,
} as const;
export type FixtureName = keyof typeof FIXTURES;
