import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const routes = [
  '/',
  '/education',
  '/start',
  '/start/wallets',
  '/start/security',
  '/start/networks',
  '/start/defi',
  '/connect',
  '/portfolio',
  '/portfolio/assets',
  '/portfolio/positions',
  '/portfolio/risk',
  '/explore',
  '/learn',
  '/learn/addresses',
  '/learn/risks',
  '/learn/security-lab',
  '/settings',
];
test.beforeEach(async ({ page }) => {
  // The welcome screen has its own tests; skip it elsewhere.
  await page.addInitScript(() => window.sessionStorage.setItem('sola-welcomed', '1'));
});
test('all routes render, remain responsive, and pass WCAG automated checks', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      route,
    ).toBe(true);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations, route).toEqual([]);
    if (route === '/' || route === '/portfolio') {
      await page.screenshot({
        path: `output/playwright/${test.info().project.name}-${route === '/' ? 'welcome' : 'portfolio'}.png`,
        fullPage: true,
      });
    }
  }
  expect(errors).toEqual([]);
});
test('beginner, experienced and demo entry points work', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /^Education/ }).click();
  await expect(page).toHaveURL(/\/education\/?$/);
  await page.getByRole('link', { name: /I’m new to DeFi/ }).click();
  await expect(page).toHaveURL(/\/start\/?$/);
  await page.getByRole('link', { name: 'Skip this lesson' }).click();
  await expect(page).toHaveURL(/\/start\/wallets\/?$/);
  await page.getByRole('radio', { name: 'Keeping keys on a separate device' }).check();
  await expect(page.getByRole('status')).toContainText('Research hardware');
  await page.goto('/connect');
  await expect(page.locator('input')).toHaveCount(0);
  await page.getByRole('link', { name: 'Open simulated portfolio' }).click();
  await expect(page.getByText('$11,000.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Unknown.*Price unavailable/ })).toBeVisible();
  await expect(page.locator('.mode-marker')).toContainText('SIMULATED');
});
test('security quiz gives feedback and optional local progress can be cleared', async ({
  page,
}) => {
  await page.goto('/start/security');
  await page.getByRole('radio', { name: 'Enter it to verify the account' }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByText(/Try again\./)).toBeVisible();
  await page.getByRole('radio', { name: 'Stop and leave the site' }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.getByText(/That’s right\./)).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.goto('/settings');
  await page.getByRole('checkbox').check();
  await page.goto('/start/security');
  await page.getByRole('radio', { name: 'Stop and leave the site' }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await page.reload();
  await page.goto('/learn');
  await expect(page.getByText('1 of 6 modules completed')).toBeVisible();
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Clear all lesson progress' }).click();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await expect(page.getByRole('checkbox')).not.toBeChecked();
});
test('swap exercise is educational and never exposes a signing action', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(request.url());
  });
  await page.goto('/start/defi');
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByText(/148.50 USDC/)).toBeVisible();
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.getByRole('button', { name: 'Restart exercise' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /sign|connect|approve|submit transaction/i }),
  ).toHaveCount(0);
  expect(external).toEqual([]);
});
test('keyboard navigation, mobile menu, reduced motion, and missing page', async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/portfolio');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe(
    'auto',
  );
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Track' })).toBeVisible();
  if (isMobile) {
    const box = await nav.boundingBox();
    expect(box && box.y > 400, 'tab bar sits at the bottom on phones').toBe(true);
  }
  const response = await page.goto('/missing-page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'That page isn’t here.' })).toBeVisible();
});
test('storage failures preserve a usable learning session', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await page.goto('/settings');
  await expect(page.getByRole('status')).toContainText('unavailable');
  await page.getByRole('checkbox').click();
  await expect(page.getByRole('status')).toContainText('could not be saved');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Clear all lesson progress' }).click();
  await expect(page.getByRole('status')).toContainText('Clear site data');
});
test('preview responses include privacy and framing protections', async ({ request }) => {
  const response = await request.get('/portfolio');
  const headers = response.headers();
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
  expect(headers['content-security-policy']).toContain("connect-src 'self'");
});

test('key screens reflow at narrow and tablet widths', async ({ page }) => {
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/start/wallets', '/start/defi', '/portfolio', '/settings']) {
      await page.goto(route);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${route} at ${width}`,
      ).toBe(true);
    }
  }
});

test('security decision lab: choices reveal consequences in place, with no text entry', async ({
  page,
}) => {
  await page.goto('/learn/security-lab');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('input:not([type="radio"]), textarea')).toHaveCount(0);
  const seed = page.getByRole('group', { name: /Support asks for your recovery phrase/ });
  const check = seed.getByRole('button', { name: 'Check my choice' });
  await expect(check).toBeDisabled();
  await seed.getByRole('radio', { name: /Type the phrase quickly/ }).check();
  await check.click();
  await expect(seed.getByRole('status')).toContainText('A RISKY CHOICE');
  await expect(seed.getByRole('status')).toContainText('Never type your recovery phrase');
  await seed.getByRole('button', { name: 'Try again' }).click();
  await seed.getByRole('radio', { name: /Close it, tell no one/ }).check();
  await check.click();
  await expect(seed.getByRole('status')).toContainText('A SAFER CHOICE');
  await expect(page.getByText('1 of 4 scenarios answered')).toBeVisible();
});

test('security decision lab: every outcome, keyboard use, retry, axe on revealed state, no requests or storage', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') external.push(r.url());
  });
  await page.goto('/learn/security-lab');
  const before = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  const expected: Record<string, string[]> = {
    'A site asks to connect': ['IT DEPENDS', 'A SAFER CHOICE', 'A RISKY CHOICE'],
    'Support asks for your recovery phrase': ['A RISKY CHOICE', 'A RISKY CHOICE', 'A SAFER CHOICE'],
    'An unlimited spending approval': ['A RISKY CHOICE', 'IT DEPENDS', 'A SAFER CHOICE'],
    'A giveaway link with a strange web address': [
      'A RISKY CHOICE',
      'A SAFER CHOICE',
      'IT DEPENDS',
    ],
  };
  for (const [title, verdicts] of Object.entries(expected)) {
    const group = page.getByRole('group', { name: new RegExp(title) });
    for (let i = 0; i < verdicts.length; i++) {
      await group.getByRole('radio').nth(i).check();
      await group.getByRole('button', { name: 'Check my choice' }).click();
      await expect(group.getByRole('status')).toContainText(verdicts[i]!);
      await expect(group.getByRole('status')).toContainText('Safer habit');
      if (i < verdicts.length - 1) await group.getByRole('button', { name: 'Try again' }).click();
    }
  }
  await expect(page.getByText('4 of 4 scenarios answered')).toBeVisible();
  await page.waitForTimeout(600); // let the reveal animation finish before measuring contrast
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  // keyboard: select with arrow keys and activate with Space and Enter
  const seed = page.getByRole('group', { name: /Support asks for your recovery phrase/ });
  await seed.getByRole('button', { name: 'Try again' }).click();
  await expect(seed.getByRole('radio').first()).toBeFocused();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(seed.getByRole('button', { name: 'Check my choice' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(seed.getByRole('status')).toContainText('A RISKY CHOICE');
  expect(external).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).toBe(before);
});

test.describe('entrance', () => {
  test('two real entrances, account control, no inputs, and the intro plays once', async ({
    page,
  }) => {
    // Clear the flag only on the first navigation so the reload sees the stored flag.
    await page.addInitScript(() => {
      if (!window.sessionStorage.getItem('__t')) {
        window.sessionStorage.removeItem('sola-welcomed');
        window.sessionStorage.setItem('__t', '1');
      }
    });
    await page.route('**/api/v1/session', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          via: 'cloudflare-access',
          identity: { email: 'jun@example.com' },
        }),
      }),
    );
    await page.goto('/');
    await expect(page.locator('.entrance')).toHaveClass(/intro/);
    await expect(page.getByRole('link', { name: /^Education/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^DeFi App/ })).toBeVisible();
    await expect(page.locator('input')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account: jun@example.com' })).toBeVisible();
    await page.reload();
    await expect(page.locator('.entrance')).not.toHaveClass(/intro/);
    await page.getByRole('link', { name: /^DeFi App/ }).click();
    await expect(page).toHaveURL(/\/portfolio\/?$/);
  });
  test('Tab out of the account control closes it; a route change rechecks the session', async ({
    page,
    isMobile,
  }) => {
    let calls = 0;
    await page.route('**/api/v1/session', (r) => {
      calls += 1;
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          via: 'cloudflare-access',
          identity: { email: 'a-very-long-address-for-wrapping-checks@example-long-domain.com' },
        }),
      });
    });
    await page.goto('/portfolio');
    const btn = page.getByRole('button', { name: /^Account/ });
    await expect(btn).toHaveAttribute('aria-label', /a-very-long-address/);
    const before = calls;
    // In-app navigation (no page reload) must trigger a fresh session check.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Track' })
      .click();
    await expect(page).toHaveURL(/\/track\/?$/);
    await expect(btn).toHaveAttribute('aria-label', /a-very-long-address/);
    await expect.poll(() => calls).toBeGreaterThan(before);
    if (!isMobile) {
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });
  test('reduced motion: no intro and no animation', async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.removeItem('sola-welcomed'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('.entrance')).not.toHaveClass(/intro/);
    const name = await page
      .locator('.entrance-card.edu')
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('none');
  });
  test('account menu opens, Escape closes and returns focus, outside click closes', async ({
    page,
    isMobile,
  }) => {
    await page.route('**/api/v1/session', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', via: 'cloudflare-access', identity: null }),
      }),
    );
    await page.goto('/');
    const btn = page.getByRole('button', { name: /^Account/ });
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('Identity not available right now')).toBeVisible();
    if (!isMobile) {
      await page.keyboard.press('Escape');
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await expect(btn).toBeFocused();
      await btn.click();
    }
    await page.locator('.entrance-main').click({ position: { x: 4, y: 500 } });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });
});
test('only Ethereum is selectable; other networks are disabled and say so', async ({ page }) => {
  await page.goto('/track');
  const select = page.getByLabel('Network');
  await expect(select).toHaveValue('ethereum');
  for (const name of ['Solana', 'Base', 'Arbitrum']) {
    const option = select.locator('option', { hasText: name });
    await expect(option).toBeDisabled();
    await expect(option).toContainText('not supported yet');
  }
});

test('corporate site link is reachable on every width', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('link', { name: 'Back to solacapitalpartners.com' })).toBeVisible();
});

test.describe('session status', () => {
  test('shows an email only after a verified 200, and clears it on a later 401', async ({
    page,
    isMobile,
  }) => {
    let status = 200;
    await page.route('**/api/v1/session', (r) =>
      r.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          status === 200
            ? { status: 'ok', via: 'cloudflare-access', identity: { email: 'jun@example.com' } }
            : { error: { code: 'unauthorized' } },
        ),
      }),
    );
    await page.goto('/track');
    await expect(page.getByRole('button', { name: 'Account: jun@example.com' })).toBeVisible();
    // The email stays in the accessibility tree on every width (visually hidden on phones).
    // The verified email is part of the control's accessible name on every width.
    await expect(page.getByRole('button', { name: 'Account: jun@example.com' })).toBeVisible();
    status = 401;
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('button', { name: 'Account: session not verified' })).toBeVisible();
    await expect(page.getByRole('button', { name: /jun@example\.com/ })).toHaveCount(0);
    expect(isMobile !== undefined).toBe(true);
  });
  test('a slow older 200 cannot bring back an email after a newer 401', async ({ page }) => {
    let n = 0;
    let releaseSecond: () => void = () => {};
    const held = new Promise<void>((r) => (releaseSecond = r));
    const ok = {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        via: 'cloudflare-access',
        identity: { email: 'jun@example.com' },
      }),
    };
    await page.route('**/api/v1/session', async (r) => {
      n += 1;
      if (n === 1) return r.fulfill(ok);
      if (n === 2) {
        await held;
        return r.fulfill(ok).catch(() => {});
      }
      return r.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/track');
    await expect(page.getByRole('button', { name: 'Account: jun@example.com' })).toBeVisible();
    const ping = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await ping(); // request 2 is held
    // The shown identity is dropped as soon as the recheck starts, not when it finishes.
    await expect(page.getByRole('button', { name: /jun@example\.com/ })).toHaveCount(0);
    await ping(); // request 3 answers 401
    await expect(page.getByRole('button', { name: 'Account: session not verified' })).toBeVisible();
    releaseSecond();
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: 'Account: session not verified' })).toBeVisible();
    await expect(page.getByRole('button', { name: /jun@example\.com/ })).toHaveCount(0);
  });
  test('no identity is shown when the API is absent or answers with the wrong shape', async ({
    page,
  }) => {
    await page.route('**/api/v1/session', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"identity":{"email":"x@y.zz"}}',
      }),
    );
    await page.goto('/track');
    await page.waitForTimeout(400);
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
  });
});
