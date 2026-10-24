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
  // The welcome screen has its own tests; skip it here.
  await page.addInitScript(() => window.sessionStorage.setItem('sola-welcomed', '1'));
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
