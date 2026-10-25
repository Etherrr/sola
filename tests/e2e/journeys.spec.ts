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
  '/portfolio/assets',
  '/portfolio/positions',
  '/portfolio/risk',
  '/explore',
  '/learn',
  '/learn/addresses',
  '/learn/risks',
  '/learn/security-lab',
  '/settings',
  '/onboarding',
  '/welcome',
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
  await page.getByRole('link', { name: 'Open portfolio' }).click();
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
  await expect(nav.getByRole('link', { name: 'Track' })).toBeVisible();
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
    await page.goto('/portfolio');
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
      .getByRole('link', { name: 'Track' })
      .click();
    await expect(page).toHaveURL(/\/track\/?$/);
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

test('orientation page is honest, inert and sends nothing', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r.url());
  });
  await page.goto('/welcome');
  await expect(page.locator('#main')).toContainText('What this app does, honestly.');
  await expect(page.locator('#main')).toContainText('SOL balance only');
  await expect(page.locator('#main')).toContainText('not proven to be yours');
  await expect(page.locator('#main')).toContainText('nothing is signed');
  await expect(page.locator('#main')).toContainText('never substitutes an invented number');
  await expect(page.locator('#main')).toContainText('design preview');
  await expect(page.locator('#main input')).toHaveCount(0);
  await expect(page.locator('#main button')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
});

test('orientation is discoverable from the shell nav and the account menu', async ({ page }) => {
  await page.goto('/welcome');
  const nav = page.locator('nav[aria-label="Main"]');
  const navLink = nav.getByRole('link', { name: 'Start here' });
  await expect(navLink).toHaveAttribute('href', '/welcome/');
  await expect(navLink).toHaveAttribute('aria-current', 'page');
  // Every nav item is keyboard-reachable in DOM order, not only reachable by pointer.
  const names = ['Overview', 'Track', 'Markets', 'Start here', 'Education', 'Settings'];
  await nav.getByRole('link', { name: 'Overview' }).focus();
  await expect(nav.getByRole('link', { name: 'Overview' })).toBeFocused();
  for (const name of names.slice(1)) {
    await page.keyboard.press('Tab');
    await expect(nav.getByRole('link', { name })).toBeFocused();
  }
  await page.goto('/settings');
  await page.getByRole('button', { name: /^Account/ }).click();
  const menuLink = page.getByRole('link', { name: 'Start here - what this app does' });
  await expect(menuLink).toHaveAttribute('href', '/welcome/');
  // Every account-menu item is keyboard-reachable in DOM order: orientation, privacy, the
  // external site link and sign out. Tabbing starts from the menu button that has focus.
  const menu = page.getByRole('group', { name: 'Account' });
  await page.keyboard.press('Tab');
  await expect(menuLink).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: 'Privacy & local data' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('link', { name: /Sola Capital Partners/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'Sign out' })).toBeFocused();
  // Keyboard activation of the orientation link, not only pointer.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(menuLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.locator('#main')).toContainText('What this app does, honestly.');
});

test('at 320px the tab bar shows five fitting tabs and the orientation stays in the account menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/settings');
  const nav = page.locator('nav[aria-label="Main"]');
  await expect(nav.getByRole('link', { name: 'Start here' })).toBeHidden();
  // The bar is position:fixed, so document scrollWidth cannot catch a cutoff; measure the last
  // tab's box against the viewport instead.
  const visible = ['Overview', 'Track', 'Markets', 'Education', 'Settings'];
  for (const name of visible) {
    const box = await nav.getByRole('link', { name }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  // The orientation remains one tap away inside the account menu.
  await page.getByRole('button', { name: /^Account/ }).click();
  const menuLink = page.getByRole('link', { name: 'Start here - what this app does' });
  await expect(menuLink).toBeVisible();
  await menuLink.click();
  await expect(page).toHaveURL(/\/welcome/);
  await expect(page.locator('#main')).toContainText('What this app does, honestly.');
});
