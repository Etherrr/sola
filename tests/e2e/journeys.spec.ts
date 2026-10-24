import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const routes = [
  '/',
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
  await page.getByRole('link', { name: /I’m new to DeFi/ }).click();
  await expect(page).toHaveURL(/\/start\/?$/);
  await page.getByRole('link', { name: 'Skip this lesson' }).click();
  await expect(page).toHaveURL(/\/start\/wallets\/?$/);
  await page.getByRole('radio', { name: 'Keeping keys on a separate device' }).check();
  await expect(page.getByRole('status')).toContainText('Research hardware');
  await page.goto('/');
  await page.getByRole('link', { name: /I know my way around/ }).click();
  await expect(page).toHaveURL(/\/connect\/?$/);
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
  await page.goto('/');
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

test.describe('welcome screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.removeItem('sola-welcomed'));
  });
  test('shows once per session, focuses Enter, and Escape dismisses it', async ({ page }) => {
    await page.goto('/track');
    const dialog = page.getByRole('dialog', { name: 'Welcome.' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter' })).toBeFocused();
    await expect(dialog).toContainText('Protected by Cloudflare Access');
    await expect(dialog.locator('input')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
  test('reduced motion removes the animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/track');
    const name = await page
      .locator('.welcome')
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('none');
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

test.describe('welcome keyboard containment', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.removeItem('sola-welcomed'));
  });
  test('Tab and Shift+Tab stay on Enter, background is inert, dismiss restores focus', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'keyboard path');
    await page.goto('/portfolio');
    const enter = page.getByRole('button', { name: 'Enter' });
    await expect(enter).toBeFocused();
    for (const key of ['Tab', 'Shift+Tab', 'Tab', 'Tab']) {
      await page.keyboard.press(key);
      const inside = await page.evaluate(() => !!document.activeElement?.closest('.welcome'));
      const body = await page.evaluate(() => document.activeElement === document.body);
      // Focus may leave the page to browser chrome (body) but never reach covered content.
      expect(inside || body, key).toBe(true);
    }
    expect(
      await page.evaluate(() => document.querySelector('.app-body')?.hasAttribute('inert')),
    ).toBe(true);
    await enter.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.welcome')).toHaveCount(0);
    await expect(page.locator('#main')).toBeFocused();
    expect(
      await page.evaluate(() => document.querySelector('.app-body')?.hasAttribute('inert')),
    ).toBe(false);
  });
});
test('corporate site link is reachable on every width', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('link', { name: 'Back to solacapitalpartners.com' })).toBeVisible();
});
