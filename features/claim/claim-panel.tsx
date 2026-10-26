'use client';
import { useEffect, useState } from 'react';
import type {
  ClaimApi,
  ClaimAttemptBody,
  ClaimErrorBody,
  ClaimPreviewBody,
  ClaimReportBody,
  ClaimReportRow,
  ClaimRow,
} from './claim-api';

/**
 * The claim panel (plan B.3, design v4 open item 4: "/account claim panel").
 * LOCAL PREP ONLY: rendered today solely by the dev preview page with synthetic
 * fixtures; the /account wiring is a separate reviewed slice.
 *
 * Honesty contract (reviewer R1/R2, second pass):
 * - "Nothing was changed" is said ONLY for server-confirmed rejections whose
 *   explicit code has documented no-change semantics (see the code sets below).
 *   A lost answer, a 5xx, an untyped rejection, or an unparseable success body
 *   is OUTCOME UNKNOWN: the move/undo may or may not have completed, the copy
 *   says so, and the recovery is Check status - never "Nothing was changed".
 * - The rolled-back view renders the AUTHORITATIVE attempt report (attempt or
 *   report endpoint), never the cached advisory preview: per-row post-undo
 *   qualifiers name exactly what happened to each row ("copied by this move -
 *   no longer active here"), so rows the user had removed stay "left removed".
 * - Recovery (R3): on revisit with an active claim, the report and undo come
 *   back ONLY when the preview disclosed this account's activeAttemptId; an
 *   active claim belonging to another account stays a plain notice.
 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'load-failed' }
  | { kind: 'already-claimed' }
  | { kind: 'recovery-failed' }
  | { kind: 'empty' }
  | { kind: 'preview'; preview: ClaimPreviewBody }
  | { kind: 'moving'; preview: ClaimPreviewBody }
  | { kind: 'move-failed'; code: string; mergedCount?: Record<string, number> }
  | { kind: 'move-unknown' }
  | { kind: 'claimed'; attemptId: string; report: ClaimReportRow[]; recovered?: boolean }
  | { kind: 'undoing'; attemptId: string; report: ClaimReportRow[] }
  | { kind: 'undo-blocked'; offenders: { network: string; address: string }[]; attemptId: string; report: ClaimReportRow[] }
  | { kind: 'undo-failed'; code: string; attemptId: string; report: ClaimReportRow[] }
  | { kind: 'undo-unknown'; attemptId: string; report: ClaimReportRow[] }
  | { kind: 'undo-checking'; attemptId: string; report: ClaimReportRow[] }
  | { kind: 'rolled-back'; report: ClaimReportRow[]; earlier?: boolean };

/**
 * Explicit codes with PROVED no-change semantics, per server/claim/routes.ts.
 * Neither a status class nor a code alone is proof - only these entries are,
 * each with its proof basis. Everything else - 'disabled' / 'not_configured'
 * (503), 'method_not_allowed', 'claim_classification_failed' (500),
 * 'claim_failed' / 'rollback_failed' (500), unknown codes, untyped rejections,
 * lost answers - is conservatively OUTCOME UNKNOWN, never "Nothing was changed"
 * (reviewer D4: no arbitrary 5xx definitive-no-change, no dead table entries).
 */
const MOVE_CONFIRMED_NOOP = new Set([
  'assertion_invalid', // 401 rejected before the batch: proof = gate order in handleClaimAttempt
  'rate_limited', // 429 rejected before the batch: proof = gate order
  'already_claimed', // 409 clean batch no-op; active claim CONFIRMED by server read
  'no_legacy_rows', // 409 clean batch no-op; empty legacy set CONFIRMED by server read
  'cap_exceeded', // 409 clean batch no-op; in-batch guards refused
]);
const UNDO_CONFIRMED_NOOP = new Set([
  'rate_limited', // 429 rejected before the batch: proof = gate order
  'unknown_attempt', // 404 B5: no ledger row for this session user; nothing touched
]);
// 'rollback_blocked' and 'already_rolled_back' are 409s with their own honest
// states (offenders / already undone) and are handled before these sets.

const NETWORK_LABEL: Record<string, string> = { ethereum: 'Ethereum', solana: 'Solana' };
const net = (n: string) => NETWORK_LABEL[n] ?? n;

const isReport = (v: unknown): v is ClaimReportRow[] =>
  Array.isArray(v) &&
  v.every(
    (r) =>
      r !== null &&
      typeof r === 'object' &&
      typeof (r as ClaimReportRow).network === 'string' &&
      typeof (r as ClaimReportRow).address === 'string' &&
      typeof (r as ClaimReportRow).disposition === 'string',
  );

function SetTable({ title, rows, empty }: { title: string; rows: ClaimRow[]; empty: string }) {
  return (
    <div className="claim-set">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="claim-empty">{empty}</p>
      ) : (
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.network}:${r.address}`}>
                <td>{net(r.network)}</td>
                <td className="claim-addr">{r.address}</td>
                <td>{r.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const DISPOSITION_LABEL: Record<ClaimReportRow['disposition'], string> = {
  copied: 'Copied',
  skipped_live_dup: "Already here - kept this account's entry",
  skipped_tombstone_dup: 'Previously removed here - left removed',
};

/** Post-undo qualifiers: true whether the undo or the user removed the row
 *  (reviewer D2 - no causal claim that the undo deleted every copied row). */
const POST_UNDO_LABEL: Record<ClaimReportRow['disposition'], string> = {
  copied: 'Copied by this move - no longer active here',
  skipped_live_dup: "Already here - kept this account's entry",
  skipped_tombstone_dup: 'Previously removed here - left removed',
};

function ReportTable({ rows, labels }: { rows: ClaimReportRow[]; labels: typeof DISPOSITION_LABEL }) {
  return (
    <table>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.network}:${r.address}`}>
            <td>{net(r.network)}</td>
            <td className="claim-addr">{r.address}</td>
            <td>{labels[r.disposition]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ClaimPanel({ api }: { api: ClaimApi }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      let r;
      try {
        r = await api.preview();
      } catch {
        if (live) setPhase({ kind: 'load-failed' });
        return;
      }
      if (!live) return;
      if (r.status !== 200) return setPhase({ kind: 'load-failed' });
      const b = r.body as ClaimPreviewBody;
      if (b.alreadyClaimed) {
        // R3 recovery: only when the preview disclosed THIS account's active
        // attempt. A claim belonging to another account stays a plain notice
        // (no attempt id, no report, no undo - existence protection preserved).
        if (typeof b.activeAttemptId === 'string' && b.activeAttemptId) {
          let rr;
          try {
            rr = await api.report(b.activeAttemptId);
          } catch {
            if (live) setPhase({ kind: 'recovery-failed' });
            return;
          }
          if (!live) return;
          if (rr.status === 200) {
            const rb = rr.body as ClaimReportBody;
            if (isReport(rb.report)) {
              if (rb.state === 'claimed')
                return setPhase({ kind: 'claimed', attemptId: b.activeAttemptId, report: rb.report, recovered: true });
              if (rb.state === 'rolled_back') return setPhase({ kind: 'rolled-back', report: rb.report, earlier: true });
            }
          }
          return setPhase({ kind: 'recovery-failed' });
        }
        return setPhase({ kind: 'already-claimed' });
      }
      if (b.toCopy.length === 0 && b.liveDuplicates.length === 0 && b.tombstoneDuplicates.length === 0)
        return setPhase({ kind: 'empty' });
      setPhase({ kind: 'preview', preview: b });
    })();
    return () => {
      live = false;
    };
  }, [api, round]);

  const recheck = () => setRound((n) => n + 1);

  /**
   * D3: undo-unknown recovery reads the KNOWN report(attemptId) first - the
   * attempt id is never dropped. claimed -> the undo did NOT complete (back to
   * the claimed view with a working undo); rolled_back -> the authoritative
   * undone view; any read failure -> REMAIN unknown (no Move button, no new
   * claim attempt).
   */
  const checkUndo = (attemptId: string, report: ClaimReportRow[]) => {
    setPhase({ kind: 'undo-checking', attemptId, report });
    api
      .report(attemptId)
      .then((r) => {
        if (r.status === 200) {
          const b = r.body as ClaimReportBody;
          if (isReport(b.report)) {
            if (b.state === 'claimed')
              return setPhase({ kind: 'claimed', attemptId, report: b.report, recovered: true });
            if (b.state === 'rolled_back') return setPhase({ kind: 'rolled-back', report: b.report });
          }
        }
        setPhase({ kind: 'undo-unknown', attemptId, report });
      })
      .catch(() => setPhase({ kind: 'undo-unknown', attemptId, report }));
  };

  const move = (preview: ClaimPreviewBody) => {
    setPhase({ kind: 'moving', preview });
    api
      .attempt()
      .then((r) => {
        if (r.status === 200) {
          const b = (r.body ?? {}) as Partial<ClaimAttemptBody>;
          // A 200 without a readable attempt id + report means the answer is
          // unusable: outcome UNKNOWN, not failure and not success.
          if (typeof b.attemptId === 'string' && b.attemptId && isReport(b.report))
            return setPhase({ kind: 'claimed', attemptId: b.attemptId, report: b.report });
          return setPhase({ kind: 'move-unknown' });
        }
        const body = (r.body ?? {}) as ClaimErrorBody;
        const code = body.error?.code ?? '';
        if (r.status >= 400 && r.status < 500 && MOVE_CONFIRMED_NOOP.has(code))
          return setPhase({ kind: 'move-failed', code, mergedCount: body.mergedCount });
        setPhase({ kind: 'move-unknown' });
      })
      .catch(() => setPhase({ kind: 'move-unknown' }));
  };

  const undo = (attemptId: string, report: ClaimReportRow[]) => {
    setPhase({ kind: 'undoing', attemptId, report });
    api
      .rollback(attemptId)
      .then((r) => {
        if (r.status === 200) {
          const b = (r.body ?? {}) as { state?: string; report?: unknown };
          if (b.state === 'rolled_back' && isReport(b.report))
            return setPhase({ kind: 'rolled-back', report: b.report });
          return setPhase({ kind: 'undo-unknown', attemptId, report });
        }
        const body = (r.body ?? {}) as ClaimErrorBody;
        const code = body.error?.code ?? '';
        if (r.status === 409 && code === 'rollback_blocked')
          return setPhase({ kind: 'undo-blocked', offenders: body.offenders ?? [], attemptId, report });
        if (r.status === 409 && code === 'already_rolled_back')
          // The undo DID complete earlier (e.g. its answer was lost): render
          // the undone state with the authoritative report already in hand.
          return setPhase({ kind: 'rolled-back', report, earlier: true });
        if (r.status >= 400 && r.status < 500 && UNDO_CONFIRMED_NOOP.has(code))
          return setPhase({ kind: 'undo-failed', code, attemptId, report });
        setPhase({ kind: 'undo-unknown', attemptId, report });
      })
      .catch(() => setPhase({ kind: 'undo-unknown', attemptId, report }));
  };

  return (
    <section className="claim-panel" aria-label="Move saved addresses">
      <h2>Move saved addresses</h2>
      {phase.kind === 'loading' && <p className="notice">Checking your old saved addresses...</p>}
      {phase.kind === 'load-failed' && (
        <p className="notice">Could not check your old saved addresses. Nothing was changed. Try again later.</p>
      )}
      {phase.kind === 'already-claimed' && (
        <p className="notice">Your old saved addresses have already been moved.</p>
      )}
      {phase.kind === 'recovery-failed' && (
        <p className="notice">
          Your old saved addresses were moved into this account, but the details could not be loaded. This visit
          changed nothing. Try again later.
        </p>
      )}
      {phase.kind === 'empty' && <p className="notice">No saved addresses were found under your old sign-in.</p>}

      {(phase.kind === 'preview' || phase.kind === 'moving') && (
        <>
          <p>
            Your old sign-in has saved addresses. Moving copies them into this account; the old list stays stored but
            stops showing here.
          </p>
          <SetTable title="Will be copied" rows={phase.preview.toCopy} empty="None." />
          <SetTable
            title="Already in this account - kept as they are"
            rows={phase.preview.liveDuplicates}
            empty="None."
          />
          <SetTable
            title="Previously removed here - left removed"
            rows={phase.preview.tombstoneDuplicates}
            empty="None."
          />
          <p className="claim-note">This is a preview; the move checks everything again before copying.</p>
          <button
            className="button primary"
            disabled={phase.kind === 'moving' || phase.preview.toCopy.length === 0}
            onClick={() => move(phase.preview)}
          >
            {phase.kind === 'moving'
              ? 'Moving...'
              : `Move ${phase.preview.toCopy.length} address${phase.preview.toCopy.length === 1 ? '' : 'es'}`}
          </button>
        </>
      )}

      {phase.kind === 'move-failed' && (
        <div className="notice">
          {phase.code === 'cap_exceeded' ? (
            <p>
              Moving would exceed the limit of 5 saved addresses per network
              {phase.mergedCount
                ? ` (Ethereum would reach ${phase.mergedCount.ethereum ?? '?'}, Solana ${phase.mergedCount.solana ?? '?'})`
                : ''}
              . Remove some addresses first. Nothing was changed.
            </p>
          ) : phase.code === 'no_legacy_rows' ? (
            <p>No saved addresses were found under your old sign-in. Nothing was changed.</p>
          ) : phase.code === 'already_claimed' ? (
            <p>Your old saved addresses have already been moved. This try changed nothing.</p>
          ) : phase.code === 'rate_limited' ? (
            <p>Too many tries in a short time. Wait a few minutes, then try again. Nothing was changed.</p>
          ) : (
            <p>The move could not be completed. Nothing was changed.</p>
          )}
        </div>
      )}

      {phase.kind === 'move-unknown' && (
        <div className="notice">
          <p>
            The move&apos;s outcome is unknown: the server&apos;s answer did not arrive complete. The move may or may
            not have completed. Do not repeat it yet - check first. If it completed, the report and undo will appear
            here.
          </p>
          <button className="button secondary" onClick={recheck}>
            Check status
          </button>
        </div>
      )}

      {(phase.kind === 'claimed' ||
        phase.kind === 'undoing' ||
        phase.kind === 'undo-blocked' ||
        phase.kind === 'undo-failed' ||
        phase.kind === 'undo-unknown' ||
        phase.kind === 'undo-checking') && (
        <>
          <p className="notice">
            {phase.kind === 'claimed' && phase.recovered
              ? 'These saved addresses were moved into this account earlier.'
              : 'Move complete. Your old list is stored and no longer shown here.'}
          </p>
          <ReportTable rows={phase.report} labels={DISPOSITION_LABEL} />
          {phase.kind === 'undo-blocked' && (
            <div className="notice">
              <p>
                {'Undo is blocked: ' +
                  phase.offenders.length +
                  ' copied address' +
                  (phase.offenders.length === 1 ? ' was' : 'es were') +
                  ' changed after the move. Reconcile or remove ' +
                  (phase.offenders.length === 1 ? 'it' : 'them') +
                  ' in this account, then try again. Nothing was changed.'}
              </p>
              <ul>
                {phase.offenders.map((o) => (
                  <li key={`${o.network}:${o.address}`}>
                    {net(o.network)} <span className="claim-addr">{o.address}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {phase.kind === 'undo-failed' && (
            <div className="notice">
              {phase.code === 'unknown_attempt' ? (
                <p>This move is no longer available to undo here. Nothing was changed.</p>
              ) : phase.code === 'rate_limited' ? (
                <p>Too many tries in a short time. Wait a few minutes, then try again. Nothing was changed.</p>
              ) : (
                <p>The undo could not be completed. Nothing was changed.</p>
              )}
            </div>
          )}
          {(phase.kind === 'undo-unknown' || phase.kind === 'undo-checking') && (
            <div className="notice">
              <p>
                The undo&apos;s outcome is unknown: the server&apos;s answer did not arrive complete. The move may or
                may not have been undone. Check before trying again.
              </p>
              <button
                className="button secondary"
                disabled={phase.kind === 'undo-checking'}
                onClick={() => {
                  if (phase.kind === 'undo-unknown') checkUndo(phase.attemptId, phase.report);
                }}
              >
                {phase.kind === 'undo-checking' ? 'Checking...' : 'Check status'}
              </button>
            </div>
          )}
          {(phase.kind === 'claimed' || phase.kind === 'undoing' || phase.kind === 'undo-blocked' || phase.kind === 'undo-failed') && (
            <button
              className="button secondary"
              disabled={phase.kind === 'undoing'}
              onClick={() => undo(phase.attemptId, phase.report)}
            >
              {phase.kind === 'undoing' ? 'Undoing...' : 'Undo this move'}
            </button>
          )}
        </>
      )}

      {phase.kind === 'rolled-back' && (
        <>
          <p className="notice">
            {phase.earlier
              ? 'This move was already undone. Addresses it copied are no longer active here; entries already in this account were kept; previously removed entries stayed removed.'
              : 'Move undone. Addresses this move copied are no longer active here; entries already in this account were kept; previously removed entries stayed removed. Your old list shows again under your old sign-in.'}
          </p>
          <ReportTable rows={phase.report} labels={POST_UNDO_LABEL} />
        </>
      )}
    </section>
  );
}
