import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const ADDR = '0x1111111111111111111111111111111111111112';
const okBody = {
  schemaVersion: 1,
  requestId: 'r',
  generatedAt: '2026-10-23T12:00:00Z',
  observedAt: '2026-10-23T12:00:00Z',
  provider: 'fixture',
  chainId: 1,
  mode: 'mock',
  simulated: true,
  wallets: [
    {
      address: ADDR,
      assets: [
        {
          assetId: 'eth',
          symbol: 'ETH',
          decimals: 18,
          amount: '1.5',
          price: '2000.00',
          value: '3000.00',
        },
        { assetId: 'x', symbol: 'XYZ', decimals: 6, amount: '10', price: null, value: null },
      ],
      partial: false,
      warnings: [],
    },
  ],
  totals: { recognizedPricedSubtotalUsd: '3000.00', unpricedAssetCount: 1, note: 'n' },
  partial: false,
  warnings: [],
};
const mock = (page: Page, status: number, body: unknown, ct = 'application/json') =>
  page.route('**/api/v1/portfolio/resolve', (r) =>
    r.fulfill({
      status,
      contentType: ct,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

test.beforeEach(async ({ page }) => {
  // The intro plays on every load now; tests that are not about it opt out via reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // The static test server has no API; answer the health and session checks so they are not console errors.
  await page.route('**/api/v1/health', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', mode: 'mock', requestId: 'r' }),
    }),
  );
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', via: 'cloudflare-access', identity: null }),
    }),
  );
});
test.describe('/track data mode follows the server', () => {
  test('live mode: labelled live, lists the covered tokens, discloses where the address goes', async ({
    page,
  }) => {
    await page.route('**/api/v1/health', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', mode: 'live', requestId: 'r' }),
      }),
    );
    await mock(page, 200, {
      ...okBody,
      provider: 'publicnode-rpc+chainlink',
      mode: 'live',
      simulated: false,
      warnings: ['Live read-only Ethereum data. Only ETH, USDC, USDT, DAI and WETH are checked.'],
      wallets: okBody.wallets.map((w) => ({
        ...w,
        assets: w.assets.map((a) =>
          a.price
            ? { ...a, priceSource: 'chainlink:ETH/USD', priceObservedAt: '2026-10-23T11:58:00Z' }
            : a,
        ),
      })),
    });
    await page.goto('/track/');
    await expect(page.getByText('WATCH-ONLY · LIVE READ')).toBeVisible();
    await expect(page.getByText(/USDC, USDT, DAI, WETH/)).toBeVisible();
    await expect(page.locator('.sim-pill')).toContainText('MODE SHOWN WITH RESULT');
    // Fixture example buttons would be real addresses in live mode, so they are not offered.
    await expect(page.getByRole('button', { name: 'Mixed tokens' })).toHaveCount(0);
    // Disclosure, token limits and the WETH proxy caveat are all shown BEFORE any lookup.
    await expect(page.getByText(/then to PublicNode/)).toBeVisible();
    await expect(page.getByText(/not proof of an empty wallet/)).toBeVisible();
    await expect(page.getByText(/WETH is priced with the ETH\/USD feed/)).toBeVisible();
    await expect(page.getByText(/USDC and USDT feeds as capped/)).toBeVisible();
    await page.getByRole('textbox').fill(ADDR);
    await page.getByRole('button', { name: /look up/i }).click();
    await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
    await expect(page.getByText(/sent the address to a public Ethereum node/)).toBeVisible();
    await expect(page.getByText(/not market quotes/)).toBeVisible();
    await expect(page.getByText(/Chainlink ETH\/USD · feed updated/)).toBeVisible();
    await expect(page.getByText(/Nothing was read from a blockchain/)).toHaveCount(0);
  });
  for (const [name, mode, sim, partial, want, not] of [
    [
      'mock empty',
      'mock',
      true,
      false,
      /An empty wallet is a valid result/,
      /cannot tell whether the wallet is empty/,
    ],
    [
      'live covered-zero',
      'live',
      false,
      false,
      /does not show that the wallet is empty/,
      /valid result|Some balances could not be read/,
    ],
    [
      'live all reads failed',
      'live',
      false,
      true,
      /this result cannot tell whether the wallet is empty/,
      /valid result|No ETH, USDC/,
    ],
  ] as const) {
    test(`empty result wording: ${name}`, async ({ page }) => {
      await page.route('**/api/v1/health', (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok', mode, requestId: 'r' }),
        }),
      );
      await mock(page, 200, {
        ...okBody,
        mode,
        simulated: sim,
        partial,
        wallets: [
          {
            address: ADDR,
            assets: [],
            partial,
            warnings: partial ? ['ETH balance could not be read; this is not a zero balance.'] : [],
          },
        ],
      });
      await page.goto('/track/');
      await page.getByRole('textbox').fill(ADDR);
      await page.getByRole('button', { name: /look up/i }).click();
      await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
      await expect(page.getByText(want)).toBeVisible();
      await expect(page.getByText(not)).toHaveCount(0);
      if (partial)
        await expect(
          page.getByText('ETH balance could not be read; this is not a zero balance.'),
        ).toBeVisible();
    });
  }
  test('a failed lookup says nothing is known, never that the wallet is empty', async ({
    page,
  }) => {
    await page.route('**/api/v1/health', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', mode: 'live', requestId: 'r' }),
      }),
    );
    await page.route('**/api/v1/portfolio/resolve', (r) =>
      r.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'rate_limited', message: 'busy' }, requestId: 'r' }),
      }),
    );
    await page.goto('/track/');
    await page.getByRole('textbox').fill(ADDR);
    await page.getByRole('button', { name: /look up/i }).click();
    await expect(page.getByText(/cannot tell you whether the wallet is empty/)).toBeVisible();
    await expect(page.getByText(/This is not an empty wallet/)).toHaveCount(0);
  });
  test('while the mode is still being checked: no examples, submit disabled, nothing is sent', async ({
    page,
  }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => (release = res));
    let posted = 0;
    await page.route('**/api/v1/portfolio/resolve', (r) => ((posted += 1), r.abort()));
    await page.route('**/api/v1/health', async (r) => {
      await gate;
      await r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', mode: 'mock', requestId: 'r' }),
      });
    });
    await page.goto('/track/');
    await expect(page.getByRole('button', { name: 'Checking mode…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Mixed tokens' })).toHaveCount(0);
    await page.getByRole('textbox').fill(ADDR);
    await page.getByRole('textbox').press('Enter');
    expect(posted).toBe(0);
    release();
    await expect(page.getByRole('button', { name: 'Mixed tokens' })).toBeVisible();
  });
  test('health unavailable: no mode claim, no fixture examples, disclosure says it may be live', async ({
    page,
  }) => {
    await page.route('**/api/v1/health', (r) => r.fulfill({ status: 503, body: '{}' }));
    await page.goto('/track/');
    await expect(page.getByRole('button', { name: 'Mixed tokens' })).toHaveCount(0);
    await expect(page.getByText(/could be live/)).toBeVisible();
    await expect(page.getByText(/could not be confirmed/)).toBeVisible();
    await expect(page.getByText('WATCH-ONLY · LIVE READ')).toHaveCount(0);
    await expect(page.getByText('WATCH-ONLY · SIMULATED')).toHaveCount(0);
  });
});
test.describe('/track live-shaped result readability (mocked response)', () => {
  const liveBody = {
    ...okBody,
    provider: 'publicnode-rpc+chainlink',
    mode: 'live',
    simulated: false,
    wallets: [
      {
        address: '0x' + 'ab'.repeat(20),
        partial: false,
        warnings: [],
        assets: [
          {
            assetId: 'eth',
            symbol: 'ETH',
            decimals: 18,
            amount: '5.773445691890789631',
            price: '2383.71109191',
            value: '13763.012345',
            priceSource: 'chainlink:ETH/USD',
            priceObservedAt: '2026-10-24T03:00:00.000Z',
          },
          {
            assetId: 'usdc',
            symbol: 'USDC',
            decimals: 6,
            amount: '38.192124',
            price: '0.99985102',
            value: '38.186434',
            priceSource: 'chainlink:USDC/USD',
            priceObservedAt: '2026-10-24T03:00:00.000Z',
          },
        ],
      },
    ],
    totals: { recognizedPricedSubtotalUsd: '13801.198779', unpricedAssetCount: 0, note: 'n' },
    warnings: [],
  };
  test('amount, price and value read together without sideways panning; exact digits on request', async ({
    page,
  }) => {
    await page.route('**/api/v1/health', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', mode: 'live', requestId: 'r' }),
      }),
    );
    await mock(page, 200, liveBody);
    await page.goto('/track/');
    await expect(page.getByText(/Nothing has been looked up yet/)).toHaveCount(0);
    await page.getByLabel(/Public Ethereum address/).fill('0x' + 'ab'.repeat(20));
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
    await expect(page.getByText(/Nothing has been looked up yet/)).toHaveCount(0);
    await expect(page.getByText('$13,763.01', { exact: true })).toBeVisible();
    await expect(page.getByText('5.773446', { exact: true })).toBeVisible();
    await expect(page.getByText('$13,801.20', { exact: true })).toBeVisible();
    await expect(page.getByText('5.773445691890789631')).toHaveCount(0);
    // Every cell of every row is inside the viewport with no horizontal pan.
    const inside = await page.evaluate(() => {
      const w = window.innerWidth;
      const cells = [...document.querySelectorAll('.track-table tbody th, .track-table tbody td')];
      const box = document.querySelector('.track-output .table-scroll') as HTMLElement;
      return {
        page: document.documentElement.scrollWidth <= w,
        scroller: box.scrollWidth <= box.clientWidth,
        cells: cells.every((c) => {
          const r = c.getBoundingClientRect();
          return r.width > 0 && r.left >= 0 && r.right <= w;
        }),
      };
    });
    expect(inside).toEqual({ page: true, scroller: true, cells: true });
    await page.getByRole('button', { name: 'Show exact values' }).click();
    await expect(page.getByText('5.773445691890789631')).toBeVisible();
    await expect(page.getByText('$13,763.012345', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show rounded' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
});
test.describe('/track huge values at every width (mocked response)', () => {
  const big = '123456789012345678901234567890.123456';
  const body = {
    ...okBody,
    provider: 'publicnode-rpc+chainlink',
    mode: 'live',
    simulated: false,
    wallets: [
      {
        address: '0x' + 'ab'.repeat(20),
        partial: false,
        warnings: [],
        assets: [
          {
            assetId: 'eth',
            symbol: 'ETH',
            decimals: 18,
            amount: big + '678',
            price: '2378.12345678',
            value: big,
            priceSource: 'chainlink:ETH/USD',
            priceObservedAt: '2026-10-24T03:00:00.000Z',
          },
          {
            assetId: 'u',
            symbol: 'USDT',
            decimals: 6,
            amount: '291.368219',
            price: null,
            value: null,
          },
        ],
      },
    ],
    totals: { recognizedPricedSubtotalUsd: big, unpricedAssetCount: 1, note: 'n' },
  };
  for (const exact of [false, true]) {
    test(`no overflow, symbol and value visible at 320, 390, 768, 1280 (${exact ? 'exact' : 'rounded'})`, async ({
      page,
    }) => {
      await page.route('**/api/v1/health', (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok', mode: 'live', requestId: 'r' }),
        }),
      );
      await mock(page, 200, body);
      await page.goto('/track/');
      await page.getByLabel(/Public Ethereum address/).fill('0x' + 'ab'.repeat(20));
      await page.getByRole('button', { name: 'Look up' }).click();
      await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
      if (exact) await page.getByRole('button', { name: 'Show exact values' }).click();
      for (const w of [320, 390, 768, 1280]) {
        await page.setViewportSize({ width: w, height: 900 });
        const m = await page.evaluate(() => {
          const vw = window.innerWidth;
          const inView = (e: Element | null) => {
            if (!e) return false;
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.left >= 0 && r.right <= vw + 0.5;
          };
          const eth = document.querySelector('.track-table tbody tr th');
          const val = document.querySelector('.track-table tbody tr .t-value');
          const dd = document.querySelector('.track-total dd');
          const box = document.querySelector('.track-output .table-scroll') as HTMLElement;
          return {
            page: document.documentElement.scrollWidth <= vw,
            scroller: box.scrollWidth <= box.clientWidth + 1,
            symbolWidth: Math.round(eth?.getBoundingClientRect().width ?? 0),
            value: inView(val),
            subtotal: inView(dd),
          };
        });
        expect(m.page, `page overflow at ${w}`).toBe(true);
        expect(m.scroller, `scroller overflow at ${w}`).toBe(true);
        expect(m.symbolWidth, `symbol width at ${w}`).toBeGreaterThan(20);
        expect(m.value, `value in view at ${w}`).toBe(true);
        expect(m.subtotal, `subtotal in view at ${w}`).toBe(true);
      }
    });
  }
});
test.describe('/track simulated lookup', () => {
  test('shows a simulated result with Unknown prices and no console errors', async ({ page }) => {
    // Smooth scrolling to the result would move targets while axe measures them.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    let posted = 0;
    await page.route('**/api/v1/portfolio/resolve', (r) => {
      posted += 1;
      expect(r.request().method()).toBe('POST');
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(okBody),
      });
    });
    await page.goto('/track/');
    await page.getByRole('button', { name: 'Mixed tokens' }).click();
    await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
    await expect(page.getByText('Unknown').first()).toBeVisible();
    // The result table must stay visible at every width, phones included (a phone-only rule once hid it).
    const row = page.getByRole('row', { name: /ETH 1\.5/ });
    await expect(row).toBeVisible();
    expect(
      await row.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.left >= 0;
      }),
    ).toBe(true);
    await expect(page.getByText(/Nothing was read from a blockchain/)).toBeVisible();
    expect(posted).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(errors).toEqual([]);
    // The sticky top bar can partly cover controls that scrolled under it; measure from the top.
    await page.evaluate(() => window.scrollTo(0, 0));
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(axe.violations).toEqual([]);
  });
  test('after a lookup the result or error start and focus are visible between the fixed bars', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const many = Array.from({ length: 30 }, (_, i) => ({
      assetId: 'a' + i,
      symbol: i === 0 ? 'A'.repeat(40) : 'TKN' + i,
      decimals: 18,
      amount: i === 0 ? '123456789012345678901234567890.123456789' : '1',
      price: null,
      value: null,
    }));
    const tall = {
      ...okBody,
      wallets: [{ ...okBody.wallets[0], assets: many }],
      totals: { ...okBody.totals, unpricedAssetCount: 30 },
    };
    const geometry = () =>
      page.evaluate(() => {
        const out = document.querySelector('.track-output') as HTMLElement;
        const bar = (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect();
        const side = (document.querySelector('.side') as HTMLElement).getBoundingClientRect();
        const r = out.getBoundingClientRect();
        const lowerBar = side.top > 100 ? side.top : window.innerHeight;
        return {
          focused: document.activeElement === out,
          topClear: r.top >= bar.bottom - 1,
          startAboveLowerBar: r.top + 40 <= lowerBar,
          noHScroll: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
    for (const [status, body] of [
      [200, tall],
      [503, { error: { code: 'disabled', message: 'x' }, requestId: 'r' }],
    ] as const) {
      await page.unroute('**/api/v1/portfolio/resolve').catch(() => {});
      await mock(page, status, body);
      await page.goto('/track/');
      await page.getByRole('button', { name: 'Mixed tokens' }).click();
      await expect(
        page.locator('.track-output [role],.track-output h2,.track-output .notice').first(),
      ).toBeVisible();
      expect(await geometry()).toEqual({
        focused: true,
        topClear: true,
        startAboveLowerBar: true,
        noHScroll: true,
      });
    }
  });
  test('Shift+Tab and Tab after a lookup never leave a focused control under a fixed bar', async ({
    page,
  }) => {
    await page.route('**/api/v1/portfolio/resolve', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(okBody) }),
    );
    await page.goto('/track/');
    await page.getByRole('button', { name: 'Mixed tokens' }).click();
    await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
    const probe = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const bar = (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect();
        const side = (document.querySelector('.side') as HTMLElement).getBoundingClientRect();
        const lower = side.top > 100 ? side.top : window.innerHeight;
        const r = el.getBoundingClientRect();
        const inBar = !!el.closest('.topbar, .side, .skip-link');
        return {
          what: (el.textContent || el.tagName).slice(0, 24),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          bar: Math.round(bar.bottom),
          lower: Math.round(lower),
          ok: inBar || (r.top >= bar.bottom - 1 && r.bottom <= lower + 1),
        };
      });
    const bad: unknown[] = [];
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(350);
      const p = await probe();
      if (!p.ok) bad.push(p);
    }
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(350);
      const p = await probe();
      if (!p.ok) bad.push(p);
    }
    expect(bad).toEqual([]);
  });
  test('malformed 200, HTML 200 and wrong-address 200 show an error and no balances', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/track/');
    for (const [body, ct] of [
      [{ wallets: [] }, 'application/json'],
      ['<html>Access sign in</html>', 'text/html'],
      [
        { ...okBody, wallets: [{ ...okBody.wallets[0], address: '0x' + '2'.repeat(40) }] },
        'application/json',
      ],
      [{ ...okBody, simulated: undefined }, 'application/json'],
    ] as const) {
      await page.unroute('**/api/v1/portfolio/resolve').catch(() => {});
      await mock(page, 200, body, ct);
      await page.getByLabel(/Public Ethereum address/).fill(ADDR);
      await page.getByRole('button', { name: 'Look up' }).click();
      await expect(page.getByText('INCOMPLETE').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Result' })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
  test('feature-off 503 reads as switched off, 401 as sign in, no balances', async ({ page }) => {
    await page.goto('/track/');
    await mock(page, 503, { error: { code: 'disabled', message: 'x' }, requestId: 'r' });
    await page.getByRole('button', { name: 'Empty wallet' }).click();
    await expect(page.getByText(/switched off on this deployment/)).toBeVisible();
    await page.unroute('**/api/v1/portfolio/resolve');
    await mock(page, 401, { error: { code: 'unauthorized', message: 'x' }, requestId: 'r' });
    await page.getByRole('button', { name: 'Empty wallet' }).click();
    await expect(page.getByText(/sign in through Access/)).toBeVisible();
    await expect(page.getByText(/No assets found/)).toHaveCount(0);
  });
  test('rejects bad input without a request, keeps focus, input is full width, skip link hidden', async ({
    page,
  }) => {
    let posted = 0;
    await page.route('**/api/v1/portfolio/resolve', (r) => ((posted += 1), r.abort()));
    await page.goto('/track/');
    const input = page.getByLabel(/Public Ethereum address/);
    await input.fill('vitalik.eth');
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByText(/0x followed by 40/).first()).toBeVisible();
    await expect(input).toBeFocused();
    expect(posted).toBe(0);
    const box = await input.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThan(Math.min(page.viewportSize()!.width - 60, 300));
    const skip = await page.locator('.skip-link').boundingBox();
    expect(skip!.y + skip!.height).toBeLessThanOrEqual(0);
  });
  test('keyboard: Tab reaches the skip link first and it becomes visible', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'keyboard path');
    await page.goto('/track/');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();
    const b = await page.locator('.skip-link').boundingBox();
    expect(b!.y).toBeGreaterThanOrEqual(0);
  });
});

test.describe('shared top bar fits at narrow widths', () => {
  for (const width of [320, 360, 390, 520]) {
    for (const path of ['/portfolio', '/track', '/settings']) {
      test(`pill text stays inside its pill at ${width}px on ${path}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 700 });
        await page.goto(path);
        const pill = page.locator('.sim-pill').first();
        await expect(pill).toBeVisible();
        const fits = await pill.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
        expect(fits).toBe(true);
        const select = page.locator('.chain-select select');
        if (await select.count()) {
          const selectedFits = await select.evaluate((el: HTMLSelectElement) => {
            const cs = getComputedStyle(el);
            const ctx = document.createElement('canvas').getContext('2d')!;
            ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
            const text = el.options[el.selectedIndex].text;
            const avail =
              el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24;
            return ctx.measureText(text).width <= avail;
          });
          expect(selectedFits).toBe(true);
        }
        const page_ok = await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        );
        expect(page_ok).toBe(true);
      });
    }
  }
});

test.describe('/track focus offsets follow the real top bar height (30-asset mock)', () => {
  for (const width of [320, 390, 520, 1280]) {
    test(`Shift+Tab and Tab keep focus clear of the bars at ${width}px`, async ({ page }) => {
      const assets = Array.from({ length: 30 }, (_, i) => ({
        assetId: `a${i}`,
        symbol: `TKN${i}`,
        decimals: 18,
        amount: '1',
        price: null,
        value: null,
      }));
      const body = {
        ...okBody,
        wallets: [{ ...okBody.wallets[0], assets }],
        totals: { recognizedPricedSubtotalUsd: '0', unpricedAssetCount: 30, note: 'n' },
      };
      await page.setViewportSize({ width, height: 844 });
      await mock(page, 200, body);
      await page.goto('/track/');
      await page.getByRole('button', { name: 'Mixed tokens' }).click();
      await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible();
      await page.waitForTimeout(500);
      const probe = () =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const bar = (document.querySelector('.topbar') as HTMLElement).getBoundingClientRect();
          const side = (document.querySelector('.side') as HTMLElement).getBoundingClientRect();
          const lower = side.top > 100 ? side.top : window.innerHeight;
          const r = el.getBoundingClientRect();
          const inBar = !!el.closest('.topbar, .side, .skip-link');
          const h = parseFloat(document.documentElement.style.getPropertyValue('--topbar-h'));
          return {
            what: (el.textContent || el.tagName).slice(0, 24),
            top: Math.round(r.top),
            bar: Math.round(bar.bottom),
            varMatches: Math.abs(h - bar.height) <= 1,
            // A tall focused region may extend past the viewport; its start must be visible.
            ok: inBar || (r.top >= bar.bottom - 1 && r.top < lower - 20),
          };
        });
      const bad: unknown[] = [];
      for (const key of ['Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Tab', 'Tab', 'Tab', 'Tab']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(350);
        const p = await probe();
        if (!p.ok || !p.varMatches) bad.push(p);
      }
      expect(bad).toEqual([]);
    });
  }
});

test.describe('manual retries and request ownership', () => {
  test('429 cooldown blocks all submits, never polls, and enables explicit retry', async ({
    page,
  }) => {
    let calls = 0;
    await page.route('**/api/v1/portfolio/resolve', (r) => {
      calls++;
      return r.fulfill({
        status: 429,
        headers: { 'retry-after': '3' },
        contentType: 'application/json',
        body: '{}',
      });
    });
    await page.goto('/track/');
    await page.getByRole('textbox').fill(ADDR);
    await page.getByRole('button', { name: 'Look up', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry lookup' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Look up', exact: true })).toBeDisabled();
    await page.getByRole('textbox').press('Enter');
    expect(calls).toBe(1);
    await expect(page.getByRole('button', { name: 'Retry lookup' })).toBeEnabled({ timeout: 6000 });
    expect(calls).toBe(1); // display timer made no network requests
    await page.screenshot({
      path: `output/playwright/retry-${test.info().project.name}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Retry lookup' }).click();
    await expect.poll(() => calls).toBe(2);
  });

  test('switching the top bar during a request discards the old network result', async ({
    page,
  }) => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route('**/api/v1/portfolio/resolve', async (r) => {
      await gate;
      await r
        .fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(okBody) })
        .catch(() => {});
    });
    await page.goto('/track/');
    await page.getByRole('textbox').fill(ADDR);
    await page.getByRole('button', { name: 'Look up', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Looking up…' })).toBeDisabled();
    await page.locator('.chain-select select').selectOption('solana');
    finish();
    await expect(page.getByRole('textbox')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Look up', exact: true })).toBeEnabled();
    await expect(page.getByRole('heading', { name: 'Result', exact: true })).toHaveCount(0);
    await expect(page.getByText('$3,000.00', { exact: true })).toHaveCount(0);
  });

  test('markets overview stays honest when the price API is not reachable', async ({ page }) => {
    // New contract: viewing the page may make one bounded overview request (manual refresh
    // thereafter); derivatives venues are never contacted; nothing is invented on failure.
    let overviewCalls = 0;
    let venueCalls = 0;
    page.on('request', (r) => {
      // The static dev server 308-redirects /api/... to a trailing slash before 404ing;
      // count only the original request, not the redirect leg. No redirect exists behind
      // the production functions route.
      if (r.redirectedFrom()) return;
      if (/\/api\/v1\/markets\/overview/.test(r.url())) overviewCalls++;
      if (/coinglass|binance/.test(r.url())) venueCalls++;
    });
    await page.goto('/markets/');
    await expect(page.getByRole('heading', { name: 'The wider market.' })).toBeVisible();
    // The static export has no functions backend, so the overview honestly reports failure.
    await expect(page.getByText('Prices are unavailable.')).toBeVisible();
    // The three derivatives cards remain unavailable; no figures are ever substituted.
    await expect(page.getByText('Not available', { exact: true })).toHaveCount(3);
    await expect(page.getByText(/\$\d/)).toHaveCount(0);
    // The coverage disclaimer is always stated.
    await expect(page.getByText(/not the whole financial market/)).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Education' }),
    ).toHaveCount(1);
    expect(overviewCalls).toBe(1);
    expect(venueCalls).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: `output/playwright/markets-${test.info().project.name}.png`,
      fullPage: true,
    });
  });
});

test.describe('/track Aave V3 positions section', () => {
  const aavePositions = [
    {
      underlyingAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      decimals: 6,
      supplied: '500.25',
      variableDebt: '0',
      suppliedValueUsd: '500.25',
      variableDebtValueUsd: '0',
      priceSource: 'chainlink:USDC/USD',
      priceObservedAt: '2026-10-23T11:58:00Z',
      observedAt: '2026-10-21T02:13:20Z',
      usageAsCollateralEnabled: true,
      reserveNote: null,
    },
    {
      underlyingAsset: '0x6b175474e89094c44da98b954eedeac495271d0f',
      symbol: 'DAI',
      decimals: 18,
      supplied: '0',
      variableDebt: '120.5',
      suppliedValueUsd: '0',
      variableDebtValueUsd: '120.5',
      priceSource: 'chainlink:DAI/USD',
      priceObservedAt: '2026-10-23T11:58:00Z',
      observedAt: '2026-10-21T02:14:20Z',
      usageAsCollateralEnabled: false,
      reserveNote: 'This reserve is frozen on Aave.',
    },
  ];
  const bodyWith = (aave: unknown) => ({
    ...okBody,
    wallets: [{ ...okBody.wallets[0], aave }],
  });
  const lookup = async (page: Page) => {
    await page.goto('/track/');
    await page.locator('#main').getByRole('textbox').fill(ADDR);
    await page.locator('#main').getByRole('button', { name: /look up/i }).click();
  };

  test('renders supplied and variable-debt positions with stored-index times and feed-only values', async ({
    page,
  }) => {
    await mock(page, 200, bodyWith({ status: 'ok', positions: aavePositions }));
    await lookup(page);
    const main = page.locator('#main');
    const section = main.getByRole('region', { name: 'Aave V3 positions (Ethereum)' });
    await expect(main.getByRole('heading', { name: 'Aave V3 positions (Ethereum)' })).toBeVisible();
    await expect(section.getByText(/Supplied and variable-debt balances on Aave V3 \(Ethereum\) only/)).toBeVisible();
    await expect(section.getByText(/No stable debt, health factor, APY, or other protocols/)).toBeVisible();
    await expect(section.getByText(/A missing position is not a zero/)).toBeVisible();
    // USDC supplied row: amount + USD value from the app's own feed, collateral flag noted.
    const usdc = section.getByRole('row', { name: /USDC/ });
    await expect(usdc.getByRole('cell').nth(0)).toContainText('500.25');
    await expect(usdc.getByRole('cell').nth(0)).toContainText('$500.25');
    await expect(usdc.getByRole('cell').nth(1)).toContainText('0');
    await expect(usdc.getByRole('cell').nth(2)).toContainText('reserve stored index time 2026-10-21 02:13 UTC');
    await expect(usdc.getByRole('rowheader')).toContainText('usable as collateral');
    // DAI debt row: debt in the debt column, never negative styling, reserve note shown.
    const dai = section.getByRole('row', { name: /DAI/ });
    await expect(dai.getByRole('cell').nth(1)).toContainText('120.5');
    await expect(dai.getByRole('cell').nth(1)).toContainText('$120.50');
    await expect(dai.getByRole('rowheader')).toContainText('This reserve is frozen on Aave.');
    await expect(dai.getByRole('cell').nth(2)).toContainText('reserve stored index time 2026-10-21 02:14 UTC');
    await expect(section.getByText(/not your total account value/)).toBeVisible();
    // The wallet subtotal stays wallet-only: it is the fixture's $3,000, not positions-inclusive.
    await expect(main.getByText(/Recognized priced subtotal/)).toBeVisible();
    await expect(main.locator('.track-total')).toContainText('$3,000.00');
  });

  test('a true empty says so, without implying other protocols were read', async ({ page }) => {
    await mock(page, 200, bodyWith({ status: 'ok', positions: [] }));
    await lookup(page);
    const section = page.locator('#main').getByRole('region', { name: 'Aave V3 positions (Ethereum)' });
    await expect(section.getByText(/No supplied or variable-debt positions were found/)).toBeVisible();
    await expect(section.getByText(/Other protocols were not checked/)).toBeVisible();
    await expect(section.getByRole('table')).toHaveCount(0);
  });

  test('an Aave-side failure is an honest unavailable section beside intact wallet balances', async ({
    page,
  }) => {
    await mock(page, 200, bodyWith({ status: 'unavailable', reason: 'rate_limited' }));
    await lookup(page);
    const main = page.locator('#main');
    const section = main.getByRole('region', { name: 'Aave V3 positions (Ethereum)' });
    await expect(section.getByText('Aave positions could not be read. Nothing was substituted.')).toBeVisible();
    await expect(section.getByText(/no automatic retry/)).toBeVisible();
    await expect(section.getByRole('table')).toHaveCount(0);
    // The wallet balances from the same response still render.
    await expect(main.getByRole('table', { name: /Wallet balances table/ })).toBeVisible();
    await expect(main.locator('.track-total')).toContainText('$3,000.00');
  });

  test('a malformed aave section rejects the whole answer rather than guessing', async ({
    page,
  }) => {
    await mock(page, 200, bodyWith({ status: 'ok', positions: [{ symbol: 'USDC' }] }));
    await lookup(page);
    await expect(
      page.locator('#main').getByText(/The answer was not in the expected form/),
    ).toBeVisible();
    await expect(
      page.locator('#main').getByRole('heading', { name: 'Aave V3 positions (Ethereum)' }),
    ).toHaveCount(0);
  });

  test('no section is rendered when the server omits it (flag off)', async ({ page }) => {
    await mock(page, 200, okBody);
    await lookup(page);
    await expect(page.locator('#main').getByRole('heading', { name: 'Result' })).toBeVisible();
    await expect(
      page.locator('#main').getByRole('heading', { name: 'Aave V3 positions (Ethereum)' }),
    ).toHaveCount(0);
  });
});
