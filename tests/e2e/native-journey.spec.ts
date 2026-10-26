import { test, expect } from '@playwright/test';
async function stub(page: import('@playwright/test').Page, signedIn = false) {
  await page.route('**/api/v1/**', r => r.fulfill({ status: 401, contentType:'application/json', body:'{"error":"unauthenticated"}' }));
  await page.route('**/api/v1/auth/email/session', r => r.fulfill({ status:signedIn?200:401, contentType:'application/json', body:signedIn?' {"status":"ok","email":"test@example.test","fresh":true}':'{"error":"unauthenticated"}' }));
  for (const route of ['summary','overview','assets','positions','risk']) await page.route(`**/api/v1/portfolio/${route}`,r=>r.fulfill({status:200,contentType:'application/json',body:'{"status":"empty","reason":"no_recorded_observations","newerPartial":false,"newerUnattributed":false}'}));
}
test('welcome waits for an intentional action and reduced motion skips transition', async ({ page }) => {
  await stub(page); await page.goto('/');
  await expect(page.locator('.entrance-curtain')).toHaveCount(0);
  await expect(page.getByText('Choose where to begin, or sign in.')).toBeVisible();
  await expect(page.locator('.entrance-card.app')).toHaveAttribute('href',/\/account\/overview\/?$/);
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.locator('.entrance-card.edu').click();
  await expect(page).toHaveURL(/\/learn\/?$/);
  await expect(page.locator('.entrance-curtain')).toHaveCount(0);
});
test('returning account reaches actual Overview, with native page navigation', async ({ page }) => {
  await stub(page,true); await page.goto('/');
  await expect(page).toHaveURL(/\/account\/overview\/?$/);
  await expect(page.getByRole('heading',{name:'Overview.',exact:true})).toBeVisible();
  await expect(page.getByText('No recorded observations yet.',{exact:false}).first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText('$12,000');
  await expect(page.locator('body')).not.toContainText('SIMULATED');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/downloads/r3-native-overview-${test.info().project.name}.png`,fullPage:false});
  await page.getByRole('link',{name:'Manage addresses',exact:true}).click();
  await expect(page).toHaveURL(/\/account\/?$/);
  await expect(page.getByRole('heading',{name:'Addresses & Wallets',exact:true})).toBeVisible();
});
test('intentional welcome animation is skippable and navigates to selected native destination',async ({page})=>{
  await stub(page);await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/');
  await page.locator('.entrance-card.app').click();
  await expect(page.getByRole('button',{name:'Skip intro'})).toBeVisible();
  await page.getByRole('button',{name:'Skip intro'}).click();
  await expect(page).toHaveURL(/\/account\/overview\/?$/);
});

test('mobile More reaches Risk, Addresses, Markets and the explicit protected legacy list',async ({page},info)=>{
  test.skip(info.project.name !== 'mobile');
  await stub(page,true);await page.goto('/account/risk/');
  await page.getByRole('button',{name:'More',exact:true}).click();
  const menu=page.getByRole('group',{name:'More',exact:true});
  for(const [name,path] of [['Risk & Return','/account/risk'],['Addresses & Wallets','/account'],['Markets','/markets'],['Legacy Track list','/portfolio']]) {
    await expect(menu.getByRole('link',{name,exact:true})).toHaveAttribute('href',path);
    await expect(menu.getByRole('link',{name,exact:true})).toBeVisible();
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/downloads/r3-native-more-mobile.png'});
});
