import { describe, expect, it } from 'vitest';
import { isSessionEmail, type SessionState } from '../features/portfolio/api-client';
import { createSessionChecker } from '../features/portfolio/session-check';

function deferred() {
  let resolve!: (s: SessionState) => void;
  const p = new Promise<SessionState>((r) => (resolve = r));
  return { p, resolve };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('session checker', () => {
  it('a late older 200 cannot overwrite a newer 401', async () => {
    const d = [deferred(), deferred(), deferred()];
    let i = 0;
    const seen: SessionState[] = [];
    const c = createSessionChecker(
      () => d[i++].p,
      (s) => seen.push(s),
    );
    c.run();
    d[0].resolve({ kind: 'verified', email: 'a@b.co' });
    await flush();
    c.run(); // req2 held
    c.run(); // req3
    d[2].resolve({ kind: 'rejected' });
    await flush();
    d[1].resolve({ kind: 'verified', email: 'stale@b.co' });
    await flush();
    expect(seen).toEqual([{ kind: 'verified', email: 'a@b.co' }, { kind: 'rejected' }]);
  });
  it('aborts the previous request when a new one starts', () => {
    const signals: AbortSignal[] = [];
    const c = createSessionChecker(
      (s) => (signals.push(s), new Promise(() => {})),
      () => {},
    );
    c.run();
    c.run();
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
  it('ignores results after dispose and aborts in flight', async () => {
    const d = deferred();
    let sig!: AbortSignal;
    const seen: SessionState[] = [];
    const c = createSessionChecker(
      (s) => ((sig = s), d.p),
      (s) => seen.push(s),
    );
    c.run();
    c.dispose();
    d.resolve({ kind: 'verified', email: 'a@b.co' });
    await flush();
    c.run();
    expect(sig.aborted).toBe(true);
    expect(seen).toEqual([]);
  });
  it('a timed-out or failed newer check clears a verified identity (none replaces it)', async () => {
    const d = [deferred(), deferred()];
    let i = 0;
    const seen: SessionState[] = [];
    const c = createSessionChecker(
      () => d[i++].p,
      (s) => seen.push(s),
    );
    c.run();
    d[0].resolve({ kind: 'verified', email: 'a@b.co' });
    await flush();
    c.run();
    d[1].resolve({ kind: 'none' });
    await flush();
    expect(seen[seen.length - 1]).toEqual({ kind: 'none' });
  });
});

describe('client email contract matches the server', () => {
  it.each([
    '',
    'a',
    'a b@c.co',
    '<x>@c.co',
    'a@b',
    'a@b.c',
    'x'.repeat(250) + '@b.co',
    5,
    null,
    {},
  ])('rejects %j', (v) => expect(isSessionEmail(v)).toBe(false));
  it('accepts a plain email', () => expect(isSessionEmail('jun@example.com')).toBe(true));
});
