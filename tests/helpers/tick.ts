/** Space consecutive recordObservation calls so their sync_runs.requested_at
 *  (wall-clock milliseconds) differ: run-baseline ordering is wall-clock with
 *  a deterministic id tiebreak (reviewer amendment A1), and tests must never
 *  depend on the tiebreak resolving same-millisecond runs. */
export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
