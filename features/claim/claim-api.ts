/**
 * Data seam for the claim panel (plan B.3, design v4). The panel NEVER fetches
 * directly: the dev preview page injects synthetic fixtures; the future
 * production wiring (a separate, independently reviewed slice that also mounts
 * the panel into /account) injects claimApiFetch. Response shapes mirror
 * server/claim/routes.ts exactly - keep them in sync.
 */

import {
  claimAttemptRequest,
  claimPreviewRequest,
  claimReportRequest,
  claimRollbackRequest,
} from '../portfolio/api-client';

/** One legacy/native address row as the preview endpoint returns it. */
export type ClaimRow = { network: string; address: string; label: string };
/** One provenance row as the report endpoint returns it. */
export type ClaimReportRow = {
  network: string;
  address: string;
  disposition: 'copied' | 'skipped_live_dup' | 'skipped_tombstone_dup';
};

export type ClaimPreviewBody = {
  advisory: true;
  alreadyClaimed: boolean;
  /**
   * Recovery handle (reviewer R3): present ONLY when an active claim exists
   * AND belongs to the authenticated session user. Absent/null when there is
   * no active claim or the active claim belongs to another account - that
   * case must NOT disclose the attempt id, the report, or an undo path.
   */
  activeAttemptId?: string | null;
  toCopy: ClaimRow[];
  liveDuplicates: ClaimRow[];
  tombstoneDuplicates: ClaimRow[];
  mergedCount: Record<string, number>;
};
export type ClaimAttemptBody = { attemptId: string; report: ClaimReportRow[] };
export type ClaimReportBody = {
  attemptId: string;
  state: 'claimed' | 'rolled_back';
  createdAt: string;
  rolledBackAt: string | null;
  report: ClaimReportRow[];
};
export type ClaimErrorBody = {
  error: { code: string };
  mergedCount?: Record<string, number>;
  offenders?: { network: string; address: string }[];
  remedy?: string;
};

/** A minimal fetch-shaped result: the panel reads status + body only. */
export type ClaimResult = { status: number; body: unknown };

export type ClaimApi = {
  preview(): Promise<ClaimResult>;
  attempt(): Promise<ClaimResult>;
  report(attemptId: string): Promise<ClaimResult>;
  rollback(attemptId: string): Promise<ClaimResult>;
};

/**
 * The production seam: same-origin calls to the mounted claim endpoints.
 * UNUSED locally (the dev page injects fixtures); reviewed for the future
 * /account wiring. The endpoints 503 while CLAIM_ENABLED ships absent - the
 * panel renders that honestly like any other failure.
 */
export const claimApiFetch: ClaimApi = {
  async preview() {
    const r = await claimPreviewRequest();
    return { status: r.status, body: await r.json().catch(() => null) };
  },
  async attempt() {
    const r = await claimAttemptRequest();
    return { status: r.status, body: await r.json().catch(() => null) };
  },
  async report(attemptId) {
    const r = await claimReportRequest(attemptId);
    return { status: r.status, body: await r.json().catch(() => null) };
  },
  async rollback(attemptId) {
    const r = await claimRollbackRequest(attemptId);
    return { status: r.status, body: await r.json().catch(() => null) };
  },
};
