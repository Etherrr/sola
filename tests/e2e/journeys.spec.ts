import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const routes = [
  '/',
  '/education',
  '/markets',
  '/start',
  '/start/wallets',
  '/start/security',
  '/start/networks',
  '/start/defi',
  '/connect',
  '/portfolio',
  '/demo',
  '/demo/assets',
  '/demo/positions',
  '/demo/risk',
  '/explore',
  '/learn',
  '/learn/addresses',
  '/learn/risks',
  '/learn/security-lab',
  '/settings',
  '/onboarding',
  '/dev/welcome',
];
test.beforeEach(async ({ page }) => {
  // The intro plays on every load now; tests that are not about it opt out via reduced motion.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});
test('all routes render, remain responsive, and pass WCAG automated checks', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator('#main h1')).toBeVisible();
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
test('beginner, experienced and demo entry points work', async ({ page, isMobile }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /^Education/ }).click();
  await expect(page).toHaveURL(/\/education\/?$/);
  await page.getByRole('link', { name: /I’m new to DeFi/ }).click();
  await expect(page).toHaveURL(/\/start\/?$/);
  await page.getByRole('link', { name: 'Skip this lesson' }).click();
  await expect(page).toHaveURL(/\/start\/wallets\/?$/);
  await page.getByRole('radio', { name: 'Keeping keys on a separate device' }).check();
  await expect(page.locator('#main').getByRole('status')).toContainText('Research hardware');
  await page.goto('/connect');
  await expect(page.locator('input')).toHaveCount(0);
  await page.getByRole('link', { name: 'Explore the demo' }).click();
  await expect(page).toHaveURL(/\/demo\/?$/);
  await expect(page.locator('#main').getByText('$11,000.00', { exact: true })).toBeVisible();
  // Phones show the holdings as a list; larger screens show the table. Same data either way.
  await expect(
    isMobile
      ? page.locator('#main .pos-cards li', { hasText: 'Price unavailable' })
      : page.locator('#main').getByRole('cell', { name: /Unknown.*Price unavailable/ }),
  ).toBeVisible();
  await expect(page.locator('#main .mode-marker')).toContainText('SIMULATED');
});
test('security quiz gives feedback and optional local progress can be cleared', async ({
  page,
}) => {
  await page.goto('/start/security');
  await page.getByRole('radio', { name: 'Enter it to verify the account' }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.locator('#main').getByText(/Try again\./)).toBeVisible();
  await page.getByRole('radio', { name: 'Stop and leave the site' }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await expect(page.locator('#main').getByText(/That’s right\./)).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.goto('/settings');
  await page.getByRole('checkbox').check();
  await page.goto('/start/security');
  await page.getByRole('radio', { name: 'Stop and leave the site' }).check();
  await page.getByRole('button', { name: 'Check answer' }).click();
  await page.reload();
  await page.goto('/learn');
  await expect(page.locator('#main').getByText('1 of 6 modules completed')).toBeVisible();
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
  await expect(page.locator('#main').getByText(/148.50 USDC/)).toBeVisible();
  await page.getByRole('button', { name: 'Next step' }).click();
  await expect(page.locator('#main').getByRole('button', { name: 'Restart exercise' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /sign|connect|approve|submit transaction/i }),
  ).toHaveCount(0);
  expect(external).toEqual([]);
});
test('security quiz and swap exercise are fully keyboard operable', async ({ page }) => {
  await page.goto('/start/security');
  const quiz = page.locator('section.quiz');
  const radios = quiz.getByRole('radio');
  await expect(radios).toHaveCount(3);
  // A radio group is one Tab stop; arrow keys move between options.
  await radios.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(radios.nth(1)).toBeFocused();
  await expect(radios.nth(1)).toBeChecked();
  await page.keyboard.press('ArrowDown');
  await expect(radios.nth(2)).toBeFocused();
  await expect(radios.nth(2)).toBeChecked();
  await page.keyboard.press('ArrowUp');
  await expect(radios.nth(1)).toBeChecked();
  await page.keyboard.press('Tab');
  const check = quiz.getByRole('button', { name: 'Check answer' });
  await expect(check).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main').getByText(/Try again\./)).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(radios.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(radios.nth(2)).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(check).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main').getByText(/That\u2019s right\./)).toBeVisible();

  await page.goto('/start/defi');
  const swap = page.locator('section.swap');
  const prev = swap.getByRole('button', { name: 'Previous step' });
  const next = swap.getByRole('button', { name: 'Next step' });
  await expect(prev).toBeDisabled();
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(swap.getByText('STEP 2 OF 3')).toBeVisible();
  await expect(prev).toBeEnabled();
  await prev.focus();
  await page.keyboard.press('Enter');
  await expect(swap.getByText('STEP 1 OF 3')).toBeVisible();
  await expect(prev).toBeDisabled();
  await next.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const restart = swap.getByRole('button', { name: 'Restart exercise' });
  await expect(restart).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(swap.getByText('STEP 1 OF 3')).toBeVisible();
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
  await expect(nav.getByRole('link', { name: 'Markets' })).toBeVisible();
  if (isMobile) {
    const box = await nav.boundingBox();
    expect(box && box.y > 400, 'tab bar sits at the bottom on phones').toBe(true);
  }
  const response = await page.goto('/missing-page');
  expect(response?.status()).toBe(404);
  await expect(page.locator('#main').getByRole('heading', { name: 'That page isn’t here.' })).toBeVisible();
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
  await expect(page.locator('#main').getByRole('status')).toContainText('unavailable');
  await page.getByRole('checkbox').click();
  await expect(page.locator('#main').getByRole('status')).toContainText('could not be saved');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Clear all lesson progress' }).click();
  await expect(page.locator('#main').getByRole('status')).toContainText('Clear site data');
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
  await expect(page.locator('#main').getByRole('heading', { level: 1 })).toBeVisible();
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
  test('two real entrances, account control, no inputs, and the intro plays on every load', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.route('**/api/v1/session', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          via: 'cloudflare-access',
          identity: { email: 'jun@example.com' },
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      }),
    );
    await page.goto('/');
    await expect(page.locator('.entrance')).toHaveClass(/intro/);
    await expect(page.locator('.entrance-curtain')).toHaveCount(1);
    // The curtain never intercepts input and is gone once the animation is over.
    expect(
      await page.locator('.entrance-curtain').evaluate((el) => getComputedStyle(el).pointerEvents),
    ).toBe('none');
    await expect(page.locator('.entrance-curtain')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByRole('link', { name: /^Education/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^DeFi App/ })).toBeVisible();
    await expect(page.locator('input')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Account: jun@example.com' })).toBeVisible();
    // The intro plays again on a fresh load - nothing is stored to suppress it.
    await page.reload();
    await expect(page.locator('.entrance')).toHaveClass(/intro/);
    await expect(page.locator('.entrance-curtain')).toHaveCount(1);
    await expect(page.locator('.entrance-curtain')).toHaveCount(0, { timeout: 5000 });
    await page.getByRole('link', { name: /^DeFi App/ }).click();
    await expect(page).toHaveURL(/\/portfolio\/?$/);
  });
  test('the identity is cleared at the token expiry, with no polling before it', async ({
    page,
  }) => {
    let calls = 0;
    let expired = false;
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();
    await page.clock.install();
    await page.route('**/api/v1/session', (r) => {
      calls += 1;
      if (expired) {
        return r.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'unauthorized' } }),
        });
      }
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          via: 'cloudflare-access',
          identity: { email: 'jun@example.com' },
          expiresAt,
        }),
      });
    });
    await page.goto('/portfolio');
    const btn = page.getByRole('button', { name: /^Account/ });
    await expect(btn).toHaveAttribute('aria-label', /jun@example.com/);
    const before = calls;
    await page.clock.fastForward('02:00');
    expect(calls).toBe(before); // no polling, and the chip is not cleared early
    await expect(btn).toHaveAttribute('aria-label', /jun@example.com/);
    expired = true;
    await page.clock.fastForward('01:30');
    await expect.poll(() => calls).toBeGreaterThan(before);
    await expect(page.getByRole('button', { name: /^Account/ })).not.toHaveAttribute(
      'aria-label',
      /jun@example.com/,
    );
  });
  test('a renewed session replaces the expiry: identity returns and the next deadline is the new one', async ({
    page,
  }) => {
    let calls = 0;
    const first = Date.now() + 3 * 60 * 1000;
    const second = first + 10 * 60 * 1000;
    await page.clock.install();
    await page.route('**/api/v1/session', (r) => {
      calls += 1;
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          via: 'cloudflare-access',
          identity: { email: 'jun@example.com' },
          expiresAt: new Date(calls === 1 ? first : second).toISOString(),
        }),
      });
    });
    await page.goto('/portfolio');
    const btn = page.getByRole('button', { name: /^Account/ });
    await expect(btn).toHaveAttribute('aria-label', /jun@example.com/);
    await page.clock.fastForward('03:30'); // past the first deadline: one renewal
    await expect.poll(() => calls).toBe(2);
    await expect(btn).toHaveAttribute('aria-label', /jun@example.com/);
    await page.clock.fastForward('05:00'); // before the new deadline: no further request
    expect(calls).toBe(2);
    await page.clock.fastForward('06:00'); // past the new deadline: renewed again
    await expect.poll(() => calls).toBe(3);
  });
  test('a response with a missing or past expiry shows no identity', async ({ page }) => {
    await page.route('**/api/v1/session', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          via: 'cloudflare-access',
          identity: { email: 'jun@example.com' },
          expiresAt: '2001-01-01T00:00:00.000Z',
        }),
      }),
    );
    await page.goto('/portfolio');
    await expect(page.getByRole('button', { name: /^Account/ })).not.toHaveAttribute(
      'aria-label',
      /jun@example.com/,
    );
  });

  test('holdings keep asset, value and debt direction on screen without sideways scrolling on phones', async ({
    page,
    isMobile,
  }) => {
    await page.goto('/demo');
    // Scope to #main: Next streams a hidden duplicate segment (#S:0) for ~170-190ms
    // after navigation; unscoped locators can transiently resolve to both copies.
    const vis = (sel: string) =>
      page.locator(`#main ${sel}`).evaluateAll((els) =>
        els.some((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.right <= window.innerWidth && r.left >= 0;
        }),
      );
    if (isMobile) {
      expect(await vis('.pos-cards li .pos-val')).toBe(true);
      await expect(page.locator('#main .pos-cards')).toBeVisible();
      await expect(page.locator('#main .pos-cards .debt')).toContainText('−$1,000.00');
      await expect(page.locator('#main .pos-cards')).toContainText('Price unavailable');
      await expect(page.locator('#main .table-scroll')).toBeHidden();
    } else {
      await expect(page.locator('#main .pos-cards')).toBeHidden();
      await expect(page.locator('#main .table-scroll')).toBeVisible();
    }
    await expect(page.locator('#main svg.donut')).toHaveAttribute('aria-label', /ETH 37.5 percent/);
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
          expiresAt: '2099-01-01T00:00:00.000Z',
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
      .getByRole('link', { name: 'Markets' })
      .click();
    await expect(page).toHaveURL(/\/markets\/?$/);
    await expect(btn).toHaveAttribute('aria-label', /a-very-long-address/);
    await expect.poll(() => calls).toBeGreaterThan(before);
    if (!isMobile) {
      await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'true');
      // Tab through every panel item; focus leaving the control must close it. The count is not
      // hard-coded so adding a panel link does not silently break the expectation.
      for (let i = 0; i < 8 && (await btn.getAttribute('aria-expanded')) === 'true'; i += 1) {
        await page.keyboard.press('Tab');
      }
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
  });
  test('reduced motion: no intro and no animation', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.entrance')).not.toHaveClass(/intro/);
    await expect(page.locator('.entrance-curtain')).toHaveCount(0);
    const name = await page
      .locator('#main .entrance-card.edu')
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
  test('sign out navigates to the Access logout with the honest scope note', async ({ page }) => {
    await page.route('**/api/v1/session', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          via: 'cloudflare-access',
          identity: { email: 'jun@example.com' },
          expiresAt: '2099-01-01T00:00:00.000Z',
        }),
      }),
    );
    // Intercept the edge logout so the test never performs a real sign-out.
    let logoutHit = false;
    await page.route('**/cdn-cgi/access/logout', (r) => {
      logoutHit = true;
      r.fulfill({ status: 200, contentType: 'text/html', body: '<title>signed out</title>' });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Account: jun@example.com' }).click();
    // The scope disclosure sits next to the button: Access has no per-application logout.
    await expect(
      page.getByText(/also signs you out of other apps protected by this Cloudflare Access account/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/cdn-cgi/access/logout**');
    expect(logoutHit).toBe(true);
  });
});
test('the top-bar network selector and the track form share one selection', async ({ page }) => {
  await page.goto('/track');
  const select = page.getByRole('combobox', { name: 'Network', exact: true });
  await expect(select).toHaveValue('ethereum');
  // Only networks the lookup actually reads are offered; none are disabled placeholders.
  await expect(select.locator('option')).toHaveText(['Ethereum', 'Solana (SOL only)']);
  await expect(select.locator('option[disabled]')).toHaveCount(0);
  // Selecting Solana in the top bar switches the form to the Solana label and coverage.
  await select.selectOption('solana');
  await expect(page.locator('#main').getByText('Public Solana address (Solana mainnet)')).toBeVisible();
  // And the form chip reflects the same single selection.
  await expect(page.getByRole('button', { name: 'Solana (SOL only)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Switching back from the form chip moves the top-bar selector too.
  await page.getByRole('button', { name: 'Ethereum', exact: true }).click();
  await expect(select).toHaveValue('ethereum');
  await expect(page.locator('#main').getByText('Public Ethereum address (Ethereum mainnet)')).toBeVisible();
});

test('corporate site link is reachable on every width', async ({ page }) => {
  await page.goto('/settings');
  // Reachable on every width: the top bar shows it on wide layouts, the app
  // footer carries the same destination on every width including phones.
  await expect(
    page.locator('footer').getByRole('link', { name: 'solacapitalpartners.com' }),
  ).toBeVisible();
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
            ? {
                status: 'ok',
                via: 'cloudflare-access',
                identity: { email: 'jun@example.com' },
                expiresAt: '2099-01-01T00:00:00.000Z',
              }
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
        expiresAt: '2099-01-01T00:00:00.000Z',
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

test('welcome animation visual evidence uses no account identity; reduced motion skips it', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', via: 'cloudflare-access', identity: null }),
    }),
  );
  await page.goto('/');
  await expect(page.locator('.entrance-curtain')).toHaveCount(1);
  await page.waitForTimeout(600); // inspect an actual CSS animation frame, no provider calls
  await page.screenshot({
    path: `output/playwright/welcome-animation-${test.info().project.name}.png`,
  });
  await expect(page.locator('.entrance-curtain')).toHaveCount(0, { timeout: 5000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('.entrance')).not.toHaveClass(/intro/);
  await expect(page.getByRole('link', { name: /^DeFi App/ })).toBeVisible();
  await page.screenshot({
    path: `output/playwright/welcome-reduced-${test.info().project.name}.png`,
    fullPage: true,
  });
});

test('onboarding prototype is clearly nonfunctional: every control disabled, nothing is sent', async ({
  page,
}) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url());
  });
  await page.goto('/onboarding');
  await expect(page.locator('#main')).toContainText('VISUAL PROTOTYPE');
  await expect(page.locator('#main')).toContainText('NO SESSION IS CREATED');
  await expect(page.locator('#main')).toContainText('DECISION PENDING');
  const controls = page.locator('#main input, #main button');
  const count = await controls.count();
  expect(count).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < count; i += 1) {
    await expect(controls.nth(i)).toBeDisabled();
  }
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
});

test('native welcome door: real 48px actions, visible keyboard focus, nothing sent', async ({
  page,
}) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url());
  });
  // Deterministic signed-out native branch: the door renders its two entry actions.
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/dev/welcome');
  const main = page.locator('#main');
  const signIn = main.getByRole('link', { name: 'Sign in', exact: true });
  const create = main.getByRole('link', { name: 'Create account' });
  await expect(signIn).toHaveAttribute('href', '/sign-in');
  await expect(create).toHaveAttribute('href', '/create-account');
  // Touch targets: both entry actions meet the 48px minimum.
  for (const action of [signIn, create]) {
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  }
  // Keyboard: tabbing reaches Sign in with a VISIBLE focus outline, then Create account.
  let reached = false;
  for (let i = 0; i < 25 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    reached = await signIn.evaluate((el) => el === document.activeElement);
  }
  expect(reached, 'Sign in is keyboard-reachable').toBe(true);
  const outline = await signIn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { style: cs.outlineStyle, width: cs.outlineWidth };
  });
  expect(outline.style).toBe('solid');
  expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Tab');
  await expect(create).toBeFocused();
  // The door sends nothing on its own.
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
});

test('v2 overview: signed-out shows one honest card; live session keeps sections', async ({
  page,
}) => {
  // 401 branch: one unified card with one action, no repeated sign-in lines.
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  await expect(
    main.getByText('Sign in to see your holdings, addresses and recorded history.'),
  ).toBeVisible();
  await expect(main.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
    'href',
    '/sign-in',
  );
  await expect(main).not.toContainText('Sign in to load your recorded holdings.');
  await page.unroute('**/api/v1/auth/email/session');
  // Live native session: the per-section structure renders instead of the card.
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.goto('/dev/overview-v2');
  await expect(main.locator('.ov2-block').first()).toBeVisible();
  await expect(
    main.getByText('Sign in to see your holdings, addresses and recorded history.'),
  ).toHaveCount(0);
});

test('v2 address book: Details expands recorded rows from the shared payload', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        addresses: [
          {
            network: 'ethereum',
            address: '0xAbC1230000000000000000000000000000000000',
            label: 'Main',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
        ],
      }),
    });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        scope: 'spot_balances_only',
        latestCompleteObservedAt: '2026-10-25T01:00:00Z',
        newerPartial: false,
        latest: [
          {
            assetId: 'eip155:1/native',
            network: 'ethereum',
            address: '0xabc1230000000000000000000000000000000000',
            kind: 'wallet_balance',
            amount: '1.5',
            observedAt: '2026-10-25T01:00:00Z',
          },
        ],
        prior: null,
        networks: [
          {
            network: 'ethereum',
            latestObservedAt: '2026-10-25T01:00:00Z',
            latest: [
              {
                assetId: 'eip155:1/native',
                network: 'ethereum',
                address: '0xabc1230000000000000000000000000000000000',
                kind: 'wallet_balance',
                amount: '1.5',
                observedAt: '2026-10-25T01:00:00Z',
              },
            ],
            prior: null,
          },
        ],
      }),
    }),
  );
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  // The manager and history blocks carry their own headings (visual review).
  await expect(main.getByRole('heading', { name: 'Addresses & Wallets' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'What changed' })).toBeVisible();
  // EVM case-insensitive match: the saved 0xAbC123 row expands to its recorded 1.5 ETH.
  const details = main.getByRole('button', { name: /Details for Main/ });
  await details.click();
  // Row actions stay within the viewport - no offscreen hunting (visual review).
  for (const name of [/Details for Main/, /Rename Main/, /Remove Main/, /Copy address for Main/]) {
    const box = await main.getByRole('button', { name }).boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
  }
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  const region = main.locator('.ab-details');
  await expect(region.getByRole('cell', { name: 'ETH' })).toBeVisible();
  await expect(region.getByRole('cell', { name: '1.5' })).toBeVisible();
  await expect(region).toContainText('Latest complete observation');
  // The exact instant stays in the title attribute; visible text is the human
  // locale time with timezone - never the raw ISO (visual review 2026-10-25).
  await expect(region.locator('span[title="2026-10-25T01:00:00Z"]')).toBeVisible();
  await expect(region).not.toContainText('T01:00:00Z');
  // Collapse hides the recorded rows again.
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await expect(main.locator('.ab-details')).toHaveCount(0);

  // A sync/refresh/withdraw event drops the cached payload and collapses the
  // open row; the next expand refetches. After a withdrawal (empty status) the
  // region shows the honest empty state - deleted balances never linger.
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(main.locator('.ab-details')).toHaveCount(1);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('sola:observation-synced')),
  );
  await expect(main.locator('.ab-details')).toHaveCount(0);
  await page.unroute('**/api/v1/portfolio/overview**');
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  await details.click();
  await expect(main.locator('.ab-details')).toContainText(
    'No recorded observations yet - turn on recording and refresh.',
  );
});

test('v2 address book: a pre-event in-flight response cannot repopulate cleared rows', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        addresses: [
          {
            network: 'ethereum',
            address: '0xAbC1230000000000000000000000000000000000',
            label: 'Main',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
        ],
      }),
    });
  });
  const overviewBody = (amount: string) =>
    JSON.stringify({
      status: 'ok',
      scope: 'spot_balances_only',
      latestCompleteObservedAt: '2026-10-25T01:00:00Z',
      newerPartial: false,
      latest: [
        {
          assetId: 'eip155:1/native',
          network: 'ethereum',
          address: '0xabc1230000000000000000000000000000000000',
          kind: 'wallet_balance',
          amount,
          observedAt: '2026-10-25T01:00:00Z',
        },
      ],
      prior: null,
      networks: [
        {
          network: 'ethereum',
          latestObservedAt: '2026-10-25T01:00:00Z',
          latest: [
            {
              assetId: 'eip155:1/native',
              network: 'ethereum',
              address: '0xabc1230000000000000000000000000000000000',
              kind: 'wallet_balance',
              amount,
              observedAt: '2026-10-25T01:00:00Z',
            },
          ],
          prior: null,
        },
      ],
    });
  // The Details-triggered request (call 2) is held; after the sync event it
  // resolves with STALE 1.5 while every later request serves FRESH 2.5.
  let overviewCalls = 0;
  let release!: () => void;
  const gate = new Promise<void>((res) => {
    release = res;
  });
  await page.route('**/api/v1/portfolio/overview**', async (r) => {
    overviewCalls += 1;
    const stale = overviewCalls <= 2;
    if (overviewCalls === 2) await gate;
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: overviewBody(stale ? '1.5' : '2.5'),
    });
  });
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  // Page load consumed overview request 1 before we interact.
  await expect(main.getByRole('cell', { name: 'ETH' }).first()).toBeVisible();
  const details = main.getByRole('button', { name: /Details for Main/ });
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(main.locator('.ab-details')).toHaveCount(1);
  // Sync/withdraw lands while the Details request is still in flight.
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('sola:observation-synced')),
  );
  await expect(main.locator('.ab-details')).toHaveCount(0);
  // The held pre-event response now resolves; it must NOT repopulate the row.
  release();
  await page.waitForTimeout(500);
  await expect(main.locator('.ab-details')).toHaveCount(0);
  // The next expand fetches fresh (stale 1.5 impossible, fresh 2.5 shown).
  await details.click();
  const region = main.locator('.ab-details');
  await expect(region.getByRole('cell', { name: '2.5' })).toBeVisible();
  await expect(region).not.toContainText('1.5');
});

test('v2 overview: withdrawal clears every panel without reload; stale mount response discarded', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', addresses: [] }),
    });
  });
  const row = {
    assetId: 'eip155:1/native',
    network: 'ethereum',
    address: '0xabc1230000000000000000000000000000000000',
    kind: 'wallet_balance',
    amount: '1.5',
    observedAt: '2026-10-25T01:00:00Z',
  };
  const okBody = JSON.stringify({
    status: 'ok',
    scope: 'spot_balances_only',
    latestCompleteObservedAt: '2026-10-25T01:00:00Z',
    newerPartial: false,
    latest: [row],
    prior: null,
    networks: [{ network: 'ethereum', latestObservedAt: '2026-10-25T01:00:00Z', latest: [row], prior: null }],
  });
  // Call 1 (mount, shared by Holdings + WhatChanged) is held; every later
  // call answers empty, as after a recording withdrawal.
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((res) => {
    release = res;
  });
  await page.route('**/api/v1/portfolio/overview**', async (r) => {
    calls += 1;
    if (calls === 1) {
      await gate;
      return r.fulfill({ status: 200, contentType: 'application/json', body: okBody });
    }
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    });
  });
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  await expect(main.getByText('Loading holdings…')).toBeVisible();
  // Withdrawal lands while the mount request is still in flight: both panels
  // clear and refetch, and the fresh empty answer renders.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('sola:observation-synced', { detail: { reason: 'withdraw' } }),
    ),
  );
  await expect(main.getByText(/No recorded balances yet/)).toBeVisible();
  await expect(
    main.getByText(/History begins after your first recorded observation/),
  ).toBeVisible();
  // The stale 1.5 mount response now resolves; no panel may paint it.
  release();
  await page.waitForTimeout(500);
  await expect(main.getByText(/No recorded balances yet/)).toBeVisible();
  await expect(main).not.toContainText('1.5');
});

test('v2 address lookup: on-demand lookup uses the shared rows, disclosure near the action', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', addresses: [] }),
    });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  const resolveBody: unknown = {
    schemaVersion: 1,
    mode: 'mock',
    simulated: true,
    provider: 'fixture',
    generatedAt: '2026-10-25T01:00:00Z',
    observedAt: '2026-10-25T01:00:00Z',
    wallets: [
      {
        address: '0xabc1230000000000000000000000000000000000',
        partial: false,
        warnings: [],
        assets: [
          {
            assetId: 'eip155:1/native',
            symbol: 'ETH',
            decimals: 18,
            amount: '1.5',
            price: '3000',
            value: '4500',
          },
        ],
      },
    ],
    totals: { recognizedPricedSubtotalUsd: '4500', unpricedAssetCount: 0, note: 'Subtotal covers only assets priced by verified feeds.' },
    partial: false,
    warnings: [],
  };
  await page.route('**/api/v1/portfolio/resolve**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resolveBody),
    }),
  );
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  const tool = main.locator('.ab-lookup');
  // The disclosure sits next to the action, before any lookup runs.
  await expect(
    tool.getByText(/sends the address you enter to third-party blockchain data providers/),
  ).toBeVisible();
  const input = tool.getByLabel('Address to look up');
  const go = tool.getByRole('button', { name: 'Look up' });
  // Invalid input: action stays disabled, honest hint, nothing is sent.
  await input.fill('not-an-address');
  await expect(go).toBeDisabled();
  await expect(tool.getByText(/does not look like an EVM or Solana address/)).toBeVisible();
  // Valid EVM address (mixed case): the shared row shape renders, labeled as
  // an on-demand simulated lookup, never as recorded history.
  await input.fill('0xAbC1230000000000000000000000000000000000');
  await go.click();
  await expect(tool.getByRole('cell', { name: 'ETH' })).toBeVisible();
  await expect(tool.getByRole('cell', { name: '1.5' })).toBeVisible();
  // Track parity: USD price, value, recognized priced subtotal + note.
  // exact mode: rounding would change digits, so full precision shows (Track rule).
  await expect(tool.getByRole('cell', { name: '$3,000' })).toBeVisible();
  await expect(tool.getByRole('cell', { name: '$4,500' })).toBeVisible();
  await expect(tool.getByText('Recognized priced subtotal: $4,500')).toBeVisible();
  await expect(
    tool.getByText('Subtotal covers only assets priced by verified feeds.'),
  ).toBeVisible();
  // The result names the address and network it belongs to.
  await expect(tool.getByText('Balances for')).toBeVisible();
  await expect(tool.getByText('on EVM:')).toBeVisible();
  await expect(tool.getByText(/On-demand lookup \(demo\)/)).toBeVisible();
  await expect(tool.getByText(/Not a recorded observation/)).toBeVisible();
  // Editing the input clears the result: A's balances never sit beside B.
  await input.fill('0xAbC1230000000000000000000000000000000001');
  await expect(tool.getByRole('cell', { name: 'ETH' })).toHaveCount(0);
  await expect(tool.getByText('Balances for')).toHaveCount(0);
});

test('v2 address lookup: rate limit shows the retry wording, nothing substituted', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', addresses: [] }),
    });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  await page.route('**/api/v1/portfolio/resolve**', (r) =>
    r.fulfill({
      status: 429,
      contentType: 'application/json',
      headers: { 'retry-after': '42' },
      body: JSON.stringify({ error: 'rate_limited' }),
    }),
  );
  await page.goto('/dev/overview-v2');
  const tool = page.locator('#main .ab-lookup');
  await tool.getByLabel('Address to look up').fill('0xAbC1230000000000000000000000000000000000');
  await tool.getByRole('button', { name: 'Look up' }).click();
  await expect(tool.getByText(/Retry in about 42s/)).toBeVisible();
  await expect(tool.getByRole('cell', { name: 'ETH' })).toHaveCount(0);
});

test('v2 address lookup: a live answer carries the full provider privacy footer', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', addresses: [] }),
    });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  await page.route('**/api/v1/portfolio/resolve**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        mode: 'live',
        simulated: false,
        provider: 'publicnode+chainlink',
        generatedAt: '2026-10-25T01:00:00Z',
        observedAt: '2026-10-25T01:00:00Z',
        wallets: [
          {
            address: '0xabc1230000000000000000000000000000000000',
            partial: false,
            warnings: [],
            assets: [
              {
                assetId: 'eip155:1/native',
                symbol: 'ETH',
                decimals: 18,
                amount: '1.5',
                price: '3000',
                value: '4500',
                priceSource: 'chainlink:ETH/USD',
                priceObservedAt: '2026-10-25T00:58:00Z',
              },
            ],
          },
        ],
        totals: {
          recognizedPricedSubtotalUsd: '4500',
          unpricedAssetCount: 0,
          note: 'Subtotal covers only assets priced by verified feeds.',
        },
        partial: false,
        warnings: [],
      }),
    }),
  );
  await page.goto('/dev/overview-v2');
  const tool = page.locator('#main .ab-lookup');
  await tool.getByLabel('Address to look up').fill('0xAbC1230000000000000000000000000000000000');
  await tool.getByRole('button', { name: 'Look up' }).click();
  // (Text, not cell role: the phone card-up layout drops table semantics by design.)
  await expect(tool.getByText('ETH', { exact: true })).toBeVisible();
  // Live answers carry the full provider privacy copy: the actual node, the
  // retention claim as the operator's own unverified statement, what prices are.
  await expect(
    tool.getByText(/this lookup sent the address to a public Ethereum node \(PublicNode\)/),
  ).toBeVisible();
  await expect(tool.getByText(/at most 24 hours/)).toBeVisible();
  await expect(tool.getByText(/their statement and is not verified here/)).toBeVisible();
  await expect(tool.getByText(/not market quotes/)).toBeVisible();
});

test('v2 address lookup: Aave V3 positions render separately, debt never netted', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', addresses: [] }),
    });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  const resolveBody: unknown = {
    schemaVersion: 1,
    mode: 'mock',
    simulated: true,
    provider: 'fixture',
    generatedAt: '2026-10-25T01:00:00Z',
    observedAt: '2026-10-25T01:00:00Z',
    wallets: [
      {
        address: '0xabc1230000000000000000000000000000000000',
        partial: false,
        warnings: [],
        assets: [
          {
            assetId: 'eip155:1/native',
            symbol: 'ETH',
            decimals: 18,
            amount: '1.5',
            price: '3000',
            value: '4500',
          },
        ],
        aave: {
          status: 'ok',
          positions: [
            {
              underlyingAsset: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
              symbol: 'USDC',
              decimals: 6,
              supplied: '11392.069003',
              variableDebt: '0',
              suppliedValueUsd: '11390.54',
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
              variableDebt: '2500.5',
              suppliedValueUsd: '0',
              variableDebtValueUsd: '2500.5',
              priceSource: 'chainlink:DAI/USD',
              priceObservedAt: '2026-10-23T11:58:00Z',
              observedAt: '2026-10-21T02:14:20Z',
              usageAsCollateralEnabled: false,
              reserveNote: 'This reserve is frozen on Aave.',
            },
          ],
        },
      },
    ],
    totals: {
      recognizedPricedSubtotalUsd: '4500',
      unpricedAssetCount: 0,
      note: 'Subtotal covers only assets priced by verified feeds.',
    },
    partial: false,
    warnings: [],
  };
  await page.route('**/api/v1/portfolio/resolve**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resolveBody),
    }),
  );
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  const tool = main.locator('.ab-lookup');
  await tool.getByLabel('Address to look up').fill('0xAbC1230000000000000000000000000000000000');
  await tool.getByRole('button', { name: 'Look up' }).click();
  // The shared Aave section renders in the v2 lookup result with its own heading and scope copy.
  const section = tool.getByRole('region', { name: 'Aave V3 positions (Ethereum)' });
  await expect(
    tool.getByRole('heading', { name: 'Aave V3 positions (Ethereum)' }),
  ).toBeVisible();
  await expect(
    section.getByText(/Supplied and variable-debt balances on Aave V3 \(Ethereum\) only/),
  ).toBeVisible();
  // Supplied USDC carries its collateral note; DAI debt carries the frozen-reserve note.
  await expect(section.getByRole('rowheader', { name: /USDC/ })).toContainText(
    'usable as collateral',
  );
  await expect(section.getByRole('rowheader', { name: /DAI/ })).toContainText(
    'This reserve is frozen on Aave.',
  );
  await expect(section.getByRole('cell', { name: /2,500\.5/ })).toBeVisible();
  // The priced subtotal stays wallet balances only: Aave is never netted in.
  await expect(tool.getByText('Recognized priced subtotal: $4,500')).toBeVisible();
  // Narrow-width discoverability: the pan hint shows on phones, stays hidden on desktop.
  const hint = tool.getByText('Scroll sideways for debt and observed time.');
  if (test.info().project.name === 'mobile') await expect(hint).toBeVisible();
  else await expect(hint).toBeHidden();
});

test('v2 address lookup: an Aave-side failure is honest beside intact wallet balances', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', addresses: [] }),
    });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  const resolveBody: unknown = {
    schemaVersion: 1,
    mode: 'mock',
    simulated: true,
    provider: 'fixture',
    generatedAt: '2026-10-25T01:00:00Z',
    observedAt: '2026-10-25T01:00:00Z',
    wallets: [
      {
        address: '0xabc1230000000000000000000000000000000000',
        partial: false,
        warnings: [],
        assets: [
          {
            assetId: 'eip155:1/native',
            symbol: 'ETH',
            decimals: 18,
            amount: '1.5',
            price: '3000',
            value: '4500',
          },
        ],
        aave: { status: 'unavailable', reason: 'rate_limited' },
      },
    ],
    totals: {
      recognizedPricedSubtotalUsd: '4500',
      unpricedAssetCount: 0,
      note: 'Subtotal covers only assets priced by verified feeds.',
    },
    partial: false,
    warnings: [],
  };
  await page.route('**/api/v1/portfolio/resolve**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(resolveBody),
    }),
  );
  await page.goto('/dev/overview-v2');
  const tool = page.locator('#main .ab-lookup');
  await tool.getByLabel('Address to look up').fill('0xAbC1230000000000000000000000000000000000');
  await tool.getByRole('button', { name: 'Look up' }).click();
  // Wallet balances still render; the Aave section says unavailable, nothing substituted.
  await expect(tool.getByRole('cell', { name: 'ETH' })).toBeVisible();
  const section = tool.getByRole('region', { name: 'Aave V3 positions (Ethereum)' });
  await expect(
    section.getByText(/Aave positions could not be read\. Nothing was substituted\./),
  ).toBeVisible();
  await expect(section.getByText(/rate limiting/)).toBeVisible();
});

test('v2 combined balances: explicit load combines saved addresses honestly', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        addresses: [
          {
            network: 'ethereum',
            address: '0xAbC1230000000000000000000000000000000000',
            label: 'Main',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
          {
            network: 'solana',
            address: 'SoLanaVaultAddress111111111111111111111111',
            label: 'Vault',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
        ],
      }),
    });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  await page.route('**/api/v1/portfolio/resolve**', (r) => {
    const network = JSON.parse(r.request().postData() ?? '{}').network;
    const wallet =
      network === 'solana'
        ? {
            address: 'SoLanaVaultAddress111111111111111111111111',
            partial: false,
            warnings: [],
            assets: [
              {
                assetId: 'solana:mainnet/native',
                symbol: 'SOL',
                decimals: 9,
                amount: '10',
                price: null,
                value: null,
              },
            ],
          }
        : {
            address: '0xabc1230000000000000000000000000000000000',
            partial: false,
            warnings: [],
            assets: [
              {
                assetId: 'eip155:1/native',
                symbol: 'ETH',
                decimals: 18,
                amount: '1.5',
                price: '3000',
                value: '4500',
              },
            ],
          };
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        mode: 'mock',
        simulated: true,
        provider: 'fixture',
        generatedAt: '2026-10-25T01:00:00Z',
        observedAt: network === 'solana' ? '2026-10-25T01:00:58.082Z' : '2026-10-25T01:00:17.875Z',
        wallets: [wallet],
        totals: {
          recognizedPricedSubtotalUsd: network === 'solana' ? null : '4500',
          unpricedAssetCount: network === 'solana' ? 1 : 0,
          note: 'Subtotal covers only assets priced by verified feeds.',
        },
        partial: false,
        warnings: [],
      }),
    });
  });
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  const block = main.locator('.ov2-combined');
  // Nothing loads automatically: only the explicit action exists before the click,
  // and the third-party disclosure sits beside it BEFORE any send.
  await expect(block.getByRole('button', { name: 'Load combined balances' })).toBeVisible();
  await expect(
    block.getByText(/sends your saved addresses to third-party blockchain data providers/),
  ).toBeVisible();
  await expect(block.getByText('Combined priced value')).toHaveCount(0);
  await block.getByRole('button', { name: 'Load combined balances' }).click();
  // The EVM address contributes its priced $4,500.00; the SOL address is
  // honestly unpriced (n/a + 1 unknown), never read as zero.
  await expect(block.getByText('Combined priced value · Demo')).toBeVisible();
  await expect(block.locator('.metric strong').first()).toHaveText('$4,500.00');
  // Loaded and priced are separate ideas with separate numbers (reviewer): both
  // addresses loaded; only the EVM one carries a priced value.
  await expect(block.getByText('Addresses loaded')).toBeVisible();
  await expect(block.getByText('2 of 2', { exact: true })).toBeVisible();
  await expect(block.getByText('1 with a priced value')).toBeVisible();
  // The Solana coverage limit travels with the result: compact badge visible,
  // full prose one tap away in the expandable details.
  await expect(block.getByText('Solana: SOL balance only')).toBeVisible();
  await expect(block.locator('.cov-details')).toContainText(/Solana lookups show the SOL balance only/);
  const vaultRow = block.getByRole('row', { name: /Vault/ });
  await expect(vaultRow).toContainText('n/a');
  await expect(vaultRow).toContainText('+ 1 unknown');
  const mainRow = block.getByRole('row', { name: /Main/ });
  await expect(mainRow).toContainText('$4,500.00');
  await expect(mainRow).toContainText('Loaded');
  // Incomplete is named with its reason; sources keep their own time.
  await expect(block.getByText(/Incomplete: 1 unpriced asset/)).toBeVisible();
  await expect(block.locator('.cov-details')).toContainText(/never zero/);
  // Two networks read in the same minute (17.875s vs 58.082s) collapse to ONE formatted
  // time - the metric never renders a "9:00 PM – 9:00 PM" style duplicate range.
  const read = block.locator('.metric', { hasText: 'Balances read' }).locator('strong');
  await expect(read).toContainText(/\d{1,2}:00\s/);
  await expect(read).not.toContainText('\u2013');
  await expect(block.getByText('Balances read')).toBeVisible();
});

test('v2 combined balances: empty, sign-in and switched-off states are honest', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  let addressesStatus = 200;
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: addressesStatus,
      contentType: 'application/json',
      body: JSON.stringify(
        addressesStatus === 200 ? { status: 'ok', addresses: [] } : { status: 'error' },
      ),
    });
  });
  await page.goto('/dev/overview-v2');
  const block = page.locator('#main .ov2-combined');
  // Empty book: an honest empty, never a zero total.
  await block.getByRole('button', { name: 'Load combined balances' }).click();
  await expect(block.getByText(/No saved addresses yet/)).toBeVisible();
  // Sign-in required: named, with a retry.
  addressesStatus = 401;
  await block.getByRole('button', { name: 'Load combined balances' }).click();
  await expect(block.getByText('Sign in to load your saved addresses.')).toBeVisible();
  // Feature off on this deployment: named as expected, not a fault.
  addressesStatus = 503;
  await block.getByRole('button', { name: 'Try again' }).click();
  await expect(block.getByText(/switched off on this build/)).toBeVisible();
});

test('v2 combined balances: a failed address is named, the other still counts', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        addresses: [
          {
            network: 'ethereum',
            address: '0xAbC1230000000000000000000000000000000000',
            label: 'Main',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
          {
            network: 'solana',
            address: 'SoLanaVaultAddress111111111111111111111111',
            label: 'Vault',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
        ],
      }),
    });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  await page.route('**/api/v1/portfolio/resolve**', (r) => {
    const network = JSON.parse(r.request().postData() ?? '{}').network;
    if (network === 'solana')
      return r.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'rate_limited' }, retryAfterSeconds: 30 }),
      });
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        mode: 'mock',
        simulated: true,
        provider: 'fixture',
        generatedAt: '2026-10-25T01:00:00Z',
        observedAt: '2026-10-25T01:00:00Z',
        wallets: [
          {
            address: '0xabc1230000000000000000000000000000000000',
            partial: false,
            warnings: [],
            assets: [
              {
                assetId: 'eip155:1/native',
                symbol: 'ETH',
                decimals: 18,
                amount: '1.5',
                price: '3000',
                value: '4500',
              },
            ],
          },
        ],
        totals: {
          recognizedPricedSubtotalUsd: '4500',
          unpricedAssetCount: 0,
          note: 'Subtotal covers only assets priced by verified feeds.',
        },
        partial: false,
        warnings: [],
      }),
    });
  });
  await page.goto('/dev/overview-v2');
  const block = page.locator('#main .ov2-combined');
  await block.getByRole('button', { name: 'Load combined balances' }).click();
  // The EVM address still counts; the failed Solana read is named, never zeroed.
  await expect(block.locator('.metric strong').first()).toHaveText('$4,500.00');
  await expect(block.getByText('1 of 2', { exact: true })).toBeVisible();
  const vaultRow = block.getByRole('row', { name: /Vault/ });
  await expect(vaultRow).toContainText('FAILED');
  await expect(vaultRow).toContainText('n/a');
  await expect(block.getByText(/1 address partial or failed/)).toBeVisible();
});

test('v2 combined balances: address changes and withdrawal clear stale results', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        addresses: [
          {
            network: 'ethereum',
            address: '0xAbC1230000000000000000000000000000000000',
            label: 'Main',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
        ],
      }),
    });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  await page.route('**/api/v1/portfolio/resolve**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        mode: 'mock',
        simulated: true,
        provider: 'fixture',
        generatedAt: '2026-10-25T01:00:00Z',
        observedAt: '2026-10-25T01:00:00Z',
        wallets: [
          {
            address: '0xabc1230000000000000000000000000000000000',
            partial: false,
            warnings: [],
            assets: [
              {
                assetId: 'eip155:1/native',
                symbol: 'ETH',
                decimals: 18,
                amount: '1.5',
                price: '3000',
                value: '4500',
              },
            ],
          },
        ],
        totals: {
          recognizedPricedSubtotalUsd: '4500',
          unpricedAssetCount: 0,
          note: 'Subtotal covers only assets priced by verified feeds.',
        },
        partial: false,
        warnings: [],
      }),
    }),
  );
  await page.goto('/dev/overview-v2');
  const block = page.locator('#main .ov2-combined');
  await block.getByRole('button', { name: 'Load combined balances' }).click();
  await expect(block.locator('.metric strong').first()).toHaveText('$4,500.00');
  // An address add/rename/remove anywhere in the book drops the stale result.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('sola:addresses-changed')));
  await expect(block.getByText('Combined priced value')).toHaveCount(0);
  await expect(block.getByRole('button', { name: 'Load combined balances' })).toBeVisible();
  // Reload, then a recording withdrawal clears it the same way.
  await block.getByRole('button', { name: 'Load combined balances' }).click();
  await expect(block.locator('.metric strong').first()).toHaveText('$4,500.00');
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('sola:observation-synced', { detail: { reason: 'withdraw' } })),
  );
  await expect(block.getByText('Combined priced value')).toHaveCount(0);
  await expect(block.getByRole('button', { name: 'Load combined balances' })).toBeVisible();
});

test('v2 address lookup: Solana SOL-only footer; empty incomplete answer says unknown', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', addresses: [] }),
    });
  });
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  const base = {
    schemaVersion: 1,
    mode: 'mock',
    simulated: true,
    provider: 'fixture',
    generatedAt: '2026-10-25T01:00:00Z',
    observedAt: '2026-10-25T01:00:00Z',
    totals: { recognizedPricedSubtotalUsd: null, unpricedAssetCount: 0, note: 'Subtotal covers only assets priced by verified feeds.' },
    partial: false,
    warnings: [] as string[],
  };
  let body: unknown = {
    ...base,
    wallets: [
      {
        address: 'So11111111111111111111111111111111111111112',
        partial: false,
        warnings: [],
        assets: [
          { assetId: 'solana:mainnet/native', symbol: 'SOL', decimals: 9, amount: '12.3', price: null, value: null },
        ],
      },
    ],
  };
  await page.route('**/api/v1/portfolio/resolve**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
  await page.goto('/dev/overview-v2');
  const tool = page.locator('#main .ab-lookup');
  const input = tool.getByLabel('Address to look up');
  // Solana: identity names the network, footer limits scope to the SOL balance.
  await input.fill('So11111111111111111111111111111111111111112');
  await tool.getByRole('button', { name: 'Look up' }).click();
  await expect(tool.getByText('on Solana:')).toBeVisible();
  await expect(tool.getByRole('cell', { name: '12.3' })).toBeVisible();
  // Unpriced asset: price and value say Unknown, never a $0 or invented figure.
  await expect(tool.getByRole('cell', { name: 'Unknown' })).toHaveCount(2);
  await expect(tool.getByText('Recognized priced subtotal: Unknown')).toBeVisible();
  await expect(tool.getByText('Solana lookups show the SOL balance only.')).toBeVisible();
  // Empty + incomplete answer: unknown, never "no balances found".
  body = {
    ...base,
    partial: true,
    warnings: ['A source did not answer'],
    wallets: [
      {
        address: '0xabc1230000000000000000000000000000000000',
        partial: true,
        warnings: ['A source did not answer'],
        assets: [],
      },
    ],
  };
  await input.fill('0xAbC1230000000000000000000000000000000000');
  await tool.getByRole('button', { name: 'Look up' }).click();
  await expect(
    tool.getByText('No balances returned - the answer is incomplete, so balances are unknown.'),
  ).toBeVisible();
  await expect(tool.getByText(/No balances found/)).toHaveCount(0);
});

test('shell nav is keyboard-reachable in DOM order', async ({ page, isMobile }) => {
  await page.goto('/portfolio');
  const nav = page.locator('nav[aria-label="Main"]');
  // Desktop sidebar lists Education directly; the mobile bottom bar reaches it through More.
  const tabs: Array<{ role: 'link' | 'button'; name: string }> = isMobile
    ? [
        { role: 'link', name: 'Portfolio' },
        { role: 'link', name: 'Markets' },
        { role: 'button', name: 'More' },
        { role: 'link', name: 'Settings' },
      ]
    : [
        { role: 'link', name: 'Portfolio' },
        { role: 'link', name: 'Markets' },
        { role: 'link', name: 'Legacy Track list' },
        { role: 'link', name: 'Education' },
        { role: 'link', name: 'Settings' },
      ];
  await nav.getByRole(tabs[0].role, { name: tabs[0].name }).focus();
  await expect(nav.getByRole(tabs[0].role, { name: tabs[0].name })).toBeFocused();
  for (const tab of tabs.slice(1)) {
    await page.keyboard.press('Tab');
    await expect(nav.getByRole(tab.role, { name: tab.name })).toBeFocused();
  }
  // Pin the routing contract: the Portfolio tab leads to the native account book.
  await expect(nav.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('href', '/account/');
});

test('account menu: native signed-out branch keyboard order and back', async ({ page }) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/portfolio');
  const btn = page.getByRole('button', { name: /^Account/ });
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('group', { name: 'Account' });
  await expect(menu).toContainText('Not signed in.');
  const order = ['Sign in', 'Privacy & local data', /Sola Capital Partners/] as const;
  for (const name of order) {
    await page.keyboard.press('Tab');
    await expect(menu.getByRole('link', { name })).toBeFocused();
  }
  // No passkey action and no sign-out while signed out.
  await expect(menu.getByRole('button')).toHaveCount(0);
  // Shift+Tab walks the same order backwards.
  for (const name of [...order].reverse().slice(1)) {
    await page.keyboard.press('Shift+Tab');
    await expect(menu.getByRole('link', { name })).toBeFocused();
  }
});

test('account menu: live native session shows passkey then sign out last', async ({ page }) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.goto('/portfolio');
  const btn = page.getByRole('button', { name: /^Account/ });
  await expect(btn).toHaveAttribute('aria-label', /owner@example\.com/);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('group', { name: 'Account' });
  await expect(menu).toContainText('Signed in as');
  // Exactly four tabbable panel items, in this order: privacy, external,
  // passkey setup, sign out LAST.
  await expect(menu.locator('a, button')).toHaveCount(4);
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: 'Privacy & local data' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: /Sola Capital Partners/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'Set up a passkey' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'Sign out' })).toBeFocused();
  // And back.
  await page.keyboard.press('Shift+Tab');
  await expect(menu.getByRole('button', { name: 'Set up a passkey' })).toBeFocused();
});

test('account menu: native-off branch keeps the Access sign-out and scope note', async ({
  page,
}) => {
  // Native routes off (404 on the static host maps to the Access fallback),
  // Access session verified: the menu must keep the Access sign-out with its
  // honest scope note and no passkey action.
  await page.route('**/api/v1/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        via: 'cloudflare-access',
        identity: { email: 'owner@example.com' },
        expiresAt: '2099-01-01T00:00:00.000Z',
      }),
    }),
  );
  await page.goto('/portfolio');
  const btn = page.getByRole('button', { name: /^Account/ });
  await expect(btn).toHaveAttribute('aria-label', /owner@example\.com/);
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const menu = page.getByRole('group', { name: 'Account' });
  await expect(menu).toContainText('Signed in via Cloudflare Access as');
  await expect(menu.getByRole('button', { name: 'Set up a passkey' })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: 'Privacy & local data' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: /Sola Capital Partners/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'Sign out' })).toBeFocused();
  await expect(menu).toContainText('also signs you out of other apps protected by this Cloudflare Access account');
});

test('at 320px the tab bar shows four fitting tabs and the account menu stays on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/settings');
  const nav = page.locator('nav[aria-label="Main"]');
  // The bar is position:fixed, so document scrollWidth cannot catch a cutoff; measure each
  // tab's box against the viewport instead.
  // Mobile bar: Portfolio / Markets / More (a menu button) / Settings; Education sits under More.
  const tabs: Array<{ role: 'link' | 'button'; name: string }> = [
    { role: 'link', name: 'Portfolio' },
    { role: 'link', name: 'Markets' },
    { role: 'button', name: 'More' },
    { role: 'link', name: 'Settings' },
  ];
  for (const tab of tabs) {
    const box = await nav.getByRole(tab.role, { name: tab.name }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  // More opens to Education and the Legacy Track list, and the popover stays inside the viewport.
  // Pin the routing contract on the narrow bar too.
  await expect(nav.getByRole('link', { name: 'Portfolio' })).toHaveAttribute('href', '/account/');
  const more = nav.getByRole('button', { name: 'More' });
  await more.click();
  const moreGroup = page.getByRole('group', { name: 'More' });
  for (const name of ['Education', 'Legacy Track list']) {
    const link = moreGroup.getByRole('link', { name });
    await expect(link).toBeVisible();
    const box = (await link.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
  await page.keyboard.press('Escape');
  await expect(moreGroup).toHaveCount(0);
  await expect(more).toBeFocused();
  // The open account menu must not clip past the viewport either.
  await page.getByRole('button', { name: /^Account/ }).click();
  const menu = page.getByRole('group', { name: 'Account' });
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

test('v2 allocation derives from the same combined read - no extra provider request', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        addresses: [
          {
            network: 'ethereum',
            address: '0xabc1230000000000000000000000000000000000',
            label: 'Main',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
          {
            network: 'solana',
            address: 'SoLanaVaultAddress111111111111111111111111',
            label: 'Vault',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
        ],
      }),
    });
  });
  let resolveCalls = 0;
  await page.route('**/api/v1/portfolio/resolve**', (r) => {
    resolveCalls++;
    const network = JSON.parse(r.request().postData() ?? '{}').network;
    const wallet =
      network === 'solana'
        ? {
            address: 'SoLanaVaultAddress111111111111111111111111',
            partial: false,
            warnings: [],
            assets: [
              {
                assetId: 'solana:mainnet/native',
                symbol: 'SOL',
                decimals: 9,
                amount: '10',
                price: null,
                value: null,
              },
            ],
          }
        : {
            address: '0xabc1230000000000000000000000000000000000',
            partial: false,
            warnings: [],
            assets: [
              {
                assetId: 'eip155:1/native',
                symbol: 'ETH',
                decimals: 18,
                amount: '1.5',
                price: '3000',
                value: '4500',
              },
            ],
          };
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        mode: 'mock',
        simulated: true,
        provider: 'fixture',
        generatedAt: '2026-10-25T01:00:00Z',
        observedAt: '2026-10-25T01:00:00Z',
        wallets: [wallet],
        totals: {
          recognizedPricedSubtotalUsd: network === 'solana' ? null : '4500',
          unpricedAssetCount: network === 'solana' ? 1 : 0,
          note: 'Subtotal covers only assets priced by verified feeds.',
        },
        partial: false,
        warnings: [],
      }),
    });
  });
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  const block = main.locator('.ov2-combined');
  const alloc = main.locator('.ov2-allocation');
  // Idle: allocation points at the same single action; no figures anywhere.
  await expect(alloc.getByText(/Load combined balances above/)).toBeVisible();
  await expect(alloc.getByText('$4,500.00')).toHaveCount(0);
  await block.getByRole('button', { name: 'Load combined balances' }).click();
  // The same read fills the breakdown: chain donut, holding rows, coverage.
  await expect(alloc.getByText('$4,500.00')).toBeVisible();
  await expect(alloc.getByRole('img', { name: 'Allocation: Ethereum 100 percent' })).toBeVisible();
  await expect(alloc.getByText('ETH', { exact: true })).toBeVisible();
  await expect(alloc.getByText('2 of 2 addresses loaded', { exact: true })).toBeVisible();
  await expect(alloc.getByText('1 unpriced asset unknown', { exact: true })).toBeVisible();
  await expect(alloc.getByText('Gross priced holdings only - debt excluded')).toBeVisible();
  await expect(alloc.getByText('Solana: SOL balance only')).toBeVisible();
  await expect(alloc.locator('.cov-details')).toContainText(/Coverage: 2 of 2 addresses loaded/);
  await expect(alloc.locator('.cov-details')).toContainText(/never zero/);
  await expect(alloc.getByRole('link', { name: 'Manage addresses' })).toHaveAttribute(
    'href',
    '#ov2-addresses',
  );
  // Allocation sent nothing itself: exactly one resolve per network, from the load.
  expect(resolveCalls).toBe(2);
});

test('v2 combined balances: a delayed response released after a change never paints stale figures', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() === 'POST') {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      });
    }
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        addresses: [
          {
            network: 'ethereum',
            address: '0xabc1230000000000000000000000000000000000',
            label: 'Main',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
        ],
      }),
    });
  });
  // The resolve answer is held until the test releases it.
  let releaseResolve: (() => void) | null = null;
  await page.route('**/api/v1/portfolio/resolve**', async (r) => {
    await new Promise<void>((done) => {
      releaseResolve = done;
    });
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        mode: 'mock',
        simulated: true,
        provider: 'fixture',
        generatedAt: '2026-10-25T01:00:00Z',
        observedAt: '2026-10-25T01:00:00Z',
        wallets: [
          {
            address: '0xabc1230000000000000000000000000000000000',
            partial: false,
            warnings: [],
            assets: [
              {
                assetId: 'eip155:1/native',
                symbol: 'ETH',
                decimals: 18,
                amount: '1.5',
                price: '3000',
                value: '4500',
              },
            ],
          },
        ],
        totals: {
          recognizedPricedSubtotalUsd: '4500',
          unpricedAssetCount: 0,
          note: 'Subtotal covers only assets priced by verified feeds.',
        },
        partial: false,
        warnings: [],
      }),
    });
  });
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  const block = main.locator('.ov2-combined');
  await block.getByRole('button', { name: 'Load combined balances' }).click();
  await expect(block.getByText('Reading saved addresses and balances…')).toBeVisible();
  // While the resolve answer is in flight, the user adds an address.
  await page.getByLabel('Address', { exact: true }).fill('0xdef4560000000000000000000000000000000000');
  await page.getByLabel('Label', { exact: true }).fill('Second');
  await page.getByRole('button', { name: 'Add address' }).click();
  // The combination resets with a named reason, not silently.
  await expect(
    block.getByText('Saved addresses changed - the earlier combination was cleared.'),
  ).toBeVisible();
  await expect(block.getByRole('button', { name: 'Load combined balances' })).toBeVisible();
  // Release the stale in-flight answer: its figures must never paint.
  releaseResolve!();
  await expect(block.getByText('Combined priced value')).toHaveCount(0);
  await expect(block.getByText('$4,500.00')).toHaveCount(0);
  await expect(
    block.getByText('Saved addresses changed - the earlier combination was cleared.'),
  ).toBeVisible();
});

test('v2 combined balances: a partial address counts as loaded and explains itself', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/email/session', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', email: 'owner@example.com', fresh: true }),
    }),
  );
  await page.route('**/api/v1/portfolio/overview**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'empty', newerPartial: false }),
    }),
  );
  await page.route('**/api/v1/portfolio/addresses**', (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        addresses: [
          {
            network: 'ethereum',
            address: '0xabc1230000000000000000000000000000000000',
            label: 'Main',
            verification: 'watched',
            createdAt: '2026-10-25T00:00:00Z',
            lastObservedAt: null,
          },
        ],
      }),
    });
  });
  await page.route('**/api/v1/portfolio/resolve**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        mode: 'mock',
        simulated: true,
        provider: 'fixture',
        generatedAt: '2026-10-25T01:00:00Z',
        observedAt: '2026-10-25T01:00:00Z',
        wallets: [
          {
            address: '0xabc1230000000000000000000000000000000000',
            partial: true,
            warnings: ['Aave V3 read failed: rate limited.'],
            assets: [
              {
                assetId: 'eip155:1/native',
                symbol: 'ETH',
                decimals: 18,
                amount: '1.5',
                price: '3000',
                value: '4500',
              },
            ],
          },
        ],
        totals: {
          recognizedPricedSubtotalUsd: '4500',
          unpricedAssetCount: 0,
          note: 'Subtotal covers only assets priced by verified feeds.',
        },
        partial: true,
        warnings: ['Aave V3 read failed: rate limited.'],
      }),
    }),
  );
  await page.goto('/dev/overview-v2');
  const main = page.locator('#main');
  const block = main.locator('.ov2-combined');
  await block.getByRole('button', { name: 'Load combined balances' }).click();
  // Partial counts toward loaded, and the count explains the partial status.
  await expect(block.getByText('1 of 1', { exact: true })).toBeVisible();
  await expect(
    block.getByText('1 with a priced value · 1 partial (some sources did not answer)'),
  ).toBeVisible();
  await expect(block.locator('.badge-warn').first()).toHaveText('PARTIAL');
  await expect(block.getByText('Main: Aave V3 read failed: rate limited.')).toBeVisible();
  // Allocation coverage explains the same partial status: badges visible, prose in details.
  const alloc = main.locator('.ov2-allocation');
  await expect(alloc.getByText('1 of 1 address loaded', { exact: true })).toBeVisible();
  await expect(alloc.getByText('1 partial', { exact: true })).toBeVisible();
  await expect(alloc.locator('.cov-details')).toContainText(
    /Coverage: 1 of 1 address loaded \(1 partial - some sources did not answer\)/,
  );
});
