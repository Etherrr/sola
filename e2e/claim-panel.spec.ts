/**
 * CLAIM PANEL behavioral UI tests (reviewer R4, second pass): the REAL panel
 * component rendered by the dev preview page (STATIC BUILD, served exactly like
 * Pages) driven through scripted fixtures. Asserts the honesty contract:
 * outcome-unknown vs server-confirmed rejection, authoritative-report rollback
 * view, owner-bound recovery, no-disclosure for claims owned elsewhere.
 * Requires `npm run build` first. NOT part of the default suite.
 * Run: npx vitest run --config e2e/vitest.claim.config.mjs
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';

let dev: ChildProcess;
let browser: Browser;

const waitFor = async (url: string, ms: number) => {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (r.status < 500) return;
    } catch { /* not up yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

beforeAll(async () => {
  dev = spawn('npm', ['start'], { cwd: process.cwd(), stdio: 'ignore' });
  await waitFor('http://127.0.0.1:3000/dev/claim/', 30000);
  browser = await chromium.launch();
}, 60000);

afterAll(async () => {
  await browser?.close();
  dev?.kill();
});

const open = async (caze: string, viewport = { width: 1278, height: 900 }): Promise<Page> => {
  const page = await browser.newPage({ viewport });
  await page.goto(`http://127.0.0.1:3000/dev/claim/?case=${caze}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400); // let discovery/mount effects settle
  return page;
};

const panelText = (page: Page) => page.locator('.claim-panel').innerText();
const buttonCount = (page: Page, name: string | RegExp) => page.getByRole('button', { name }).count();
const click = (page: Page, name: string) => page.getByRole('button', { name }).click();

describe('claim panel behavior (fixtures, static build)', () => {
  it('happy: three honest sets, move -> report, undo -> authoritative post-undo qualifiers', async () => {
    const page = await open('happy');
    let t = await panelText(page);
    expect(t).toContain('Will be copied');
    expect(t).toContain('Already in this account - kept as they are');
    expect(t).toContain('Previously removed here - left removed');
    await click(page, 'Move 3 addresses');
    await page.waitForSelector('text=Move complete.');
    t = await panelText(page);
    expect(t).toContain('Copied');
    await click(page, 'Undo this move');
    await page.waitForSelector('text=Move undone.');
    t = await panelText(page);
    // R2: the authoritative report drives the post-undo qualifiers - copied rows
    // are "removed here again", dups/tombstones keep their qualifiers.
    expect((t.match(/Copied by this move - no longer active here/g) ?? [])).toHaveLength(3);
    expect(t).toContain('Previously removed here - left removed');
    expect(t).toContain('Your old list shows again under your old sign-in.');
    await page.close();
  });

  it('cap: server-confirmed rejection says nothing was changed', async () => {
    const page = await open('cap');
    await click(page, 'Move 3 addresses');
    await page.waitForSelector('text=Moving would exceed the limit');
    expect(await panelText(page)).toContain('Nothing was changed.');
    await page.close();
  });

  it('blocked rollback: names the offender, nothing changed', async () => {
    const page = await open('blocked-rollback');
    await click(page, 'Move 3 addresses');
    await click(page, 'Undo this move');
    await page.waitForSelector('text=Undo is blocked:');
    const t = await panelText(page);
    expect(t).toContain('0x2222222222222222222222222222222222222222');
    expect(t).toContain('Nothing was changed.');
    await page.close();
  });

  it('empty: honest empty state', async () => {
    const page = await open('empty');
    await page.waitForSelector('text=No saved addresses were found under your old sign-in.');
    await page.close();
  });

  it('R1: lost attempt answer is outcome UNKNOWN with Check status, never "Nothing was changed"', async () => {
    const page = await open('move-unknown');
    await click(page, 'Move 3 addresses');
    await page.waitForSelector("text=The move's outcome is unknown:");
    const t = await panelText(page);
    expect(t).toContain('may or may not have completed');
    expect(t).not.toContain('Nothing was changed.');
    expect(await buttonCount(page, 'Check status')).toBe(1);
    await page.close();
  });

  it('R1: unparseable 200 (post-commit read failure shape) is also UNKNOWN', async () => {
    const page = await open('move-malformed');
    await click(page, 'Move 3 addresses');
    await page.waitForSelector("text=The move's outcome is unknown:");
    await page.close();
  });

  it('R1: 500 on rollback is outcome UNKNOWN, never "Nothing was changed"', async () => {
    const page = await open('undo-unknown');
    await click(page, 'Move 3 addresses');
    await click(page, 'Undo this move');
    await page.waitForSelector("text=The undo's outcome is unknown:");
    const t = await panelText(page);
    expect(t).not.toContain('Nothing was changed.');
    expect(await buttonCount(page, 'Check status')).toBe(1);
    await page.close();
  });

  it('already_rolled_back: the earlier lost undo DID complete - undone state, no undo button', async () => {
    const page = await open('already-rolled-back');
    await click(page, 'Move 3 addresses');
    await click(page, 'Undo this move');
    await page.waitForSelector('text=This move was already undone.');
    expect(await buttonCount(page, 'Undo this move')).toBe(0);
    await page.close();
  });

  it('R3: returning owner recovers report + undo via disclosed activeAttemptId', async () => {
    const page = await open('returning-claimed');
    await page.waitForSelector('text=These saved addresses were moved into this account earlier.');
    expect(await panelText(page)).toContain('Copied');
    await click(page, 'Undo this move');
    await page.waitForSelector('text=Move undone.');
    await page.close();
  });

  it('R3/B5: claim owned by another account - plain notice, NO report, NO undo', async () => {
    const page = await open('claimed-elsewhere');
    await page.waitForSelector('text=Your old saved addresses have already been moved.');
    expect(await buttonCount(page, 'Undo this move')).toBe(0);
    expect(await buttonCount(page, /Move \d+ address/)).toBe(0);
    expect(await page.locator('.claim-panel table').count()).toBe(0);
    await page.close();
  });

  it('R3: recovery read failure is honest - details could not be loaded, visit changed nothing', async () => {
    const page = await open('recovery-failed');
    await page.waitForSelector('text=but the details could not be loaded.');
    expect(await buttonCount(page, 'Undo this move')).toBe(0);
    await page.close();
  });

  it('D3: lost undo answer that DID commit - Check status reaches the authoritative undone view', async () => {
    const page = await open('undo-lost-commit');
    await click(page, 'Move 3 addresses');
    await click(page, 'Undo this move');
    await page.waitForSelector("text=The undo's outcome is unknown:");
    await click(page, 'Check status');
    await page.waitForSelector('text=Move undone.');
    const t = await panelText(page);
    expect((t.match(/Copied by this move - no longer active here/g) ?? [])).toHaveLength(3);
    expect(await buttonCount(page, 'Undo this move')).toBe(0);
    await page.close();
  });

  it('D3: 500 rollback + status read says still claimed - back to claimed view with working undo', async () => {
    const page = await open('undo-status-claimed');
    await click(page, 'Move 3 addresses');
    await click(page, 'Undo this move');
    await page.waitForSelector("text=The undo's outcome is unknown:");
    await click(page, 'Check status');
    await page.waitForSelector('text=These saved addresses were moved into this account earlier.');
    expect(await buttonCount(page, 'Undo this move')).toBe(1);
    await page.close();
  });

  it('D3: 500 rollback + failed status read - REMAINS unknown, no Move button appears', async () => {
    const page = await open('undo-status-read-fails');
    await click(page, 'Move 3 addresses');
    await click(page, 'Undo this move');
    await page.waitForSelector("text=The undo's outcome is unknown:");
    await click(page, 'Check status');
    await page.waitForSelector("text=The undo's outcome is unknown:");
    const t = await panelText(page);
    expect(t).not.toContain('Nothing was changed.');
    expect(await buttonCount(page, /Move \d+ address/)).toBe(0);
    await page.close();
  });

  it('D4: 503 disabled on attempt is conservatively UNKNOWN, never "Nothing was changed"', async () => {
    const page = await open('move-disabled');
    await click(page, 'Move 3 addresses');
    await page.waitForSelector("text=The move's outcome is unknown:");
    expect(await panelText(page)).not.toContain('Nothing was changed.');
    await page.close();
  });

  it('D1: already_claimed move error uses neutral copy, no this-account assertion', async () => {
    const page = await open('move-already-claimed');
    await click(page, 'Move 3 addresses');
    await page.waitForSelector('text=Your old saved addresses have already been moved. This try changed nothing.');
    expect(await panelText(page)).not.toContain('in this account');
    await page.close();
  });

  it('section: discovery OFF renders nothing and NEVER calls a claim endpoint', async () => {
    const page = await open('happy&surface=section&discovery=off');
    await page.waitForTimeout(1200); // let any mistaken fetch fire
    expect(await page.locator('.claim-panel').count()).toBe(0);
    expect(await buttonCount(page, 'Check for saved addresses')).toBe(0);
    const calls = await page.evaluate(() => window.__claimCalls);
    expect(calls).toMatchObject({ discover: 1, preview: 0, attempt: 0, report: 0, rollback: 0 });
    await page.close();
  });

  it('section: discovery FAILURE renders nothing and never calls a claim endpoint', async () => {
    const page = await open('happy&surface=section&discovery=error');
    await page.waitForTimeout(1200);
    expect(await buttonCount(page, 'Check for saved addresses')).toBe(0);
    const calls = await page.evaluate(() => window.__claimCalls);
    expect(calls).toMatchObject({ discover: 1, preview: 0 });
    await page.close();
  });

  it('section: discovery ON shows the entry point but fetches NOTHING until the explicit click', async () => {
    const page = await open('happy&surface=section&discovery=on');
    await page.waitForSelector('text=Check for saved addresses');
    let calls = await page.evaluate(() => window.__claimCalls);
    expect(calls).toMatchObject({ discover: 1, preview: 0, attempt: 0 });
    expect(await page.locator('.claim-panel').count()).toBe(0); // panel not mounted yet
    await click(page, 'Check for saved addresses');
    await page.waitForSelector('text=Will be copied');
    calls = await page.evaluate(() => window.__claimCalls);
    expect(calls).toMatchObject({ discover: 1, preview: 1, attempt: 0 });
    await click(page, 'Move 3 addresses');
    await page.waitForSelector('text=Move complete.');
    calls = await page.evaluate(() => window.__claimCalls);
    expect(calls).toMatchObject({ preview: 1, attempt: 1 });
    await page.close();
  });

  it('section: returning owner recovers report + undo through the same explicit path', async () => {
    const page = await open('returning-claimed&surface=section&discovery=on');
    await page.waitForSelector('text=Check for saved addresses');
    await click(page, 'Check for saved addresses');
    await page.waitForSelector('text=These saved addresses were moved into this account earlier.');
    const calls = await page.evaluate(() => window.__claimCalls);
    expect(calls).toMatchObject({ discover: 1, preview: 1, report: 1 });
    await page.close();
  });

  it('mobile viewport: happy path renders and completes', async () => {
    const page = await open('happy', { width: 390, height: 844 });
    await click(page, 'Move 3 addresses');
    await page.waitForSelector('text=Move complete.');
    await page.close();
  });
});
