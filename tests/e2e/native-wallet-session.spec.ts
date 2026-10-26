import { test,expect,type Page } from '@playwright/test';
const evm='0x1111111111111111111111111111111111111111';
const sol='So11111111111111111111111111111111111111112';
async function base(page:Page){
 await page.route('**/api/v1/**',r=>r.fulfill({status:401,json:{error:'auth_required'}}));
 await page.route('**/api/v1/session',r=>r.fulfill({status:200,json:{status:'ok',via:'cloudflare-access',identity:{email:'other-access@example.test'},expiresAt:'2099-01-01T00:00:00.000Z'}}));
 await page.route('**/api/v1/portfolio/addresses',r=>r.fulfill({status:403,json:{error:'not_entitled'}}));
}
for(const [kind,identifier] of [['wallet_evm',evm],['wallet_solana',sol]]){
 test(`${kind} gets native identity/actions and identity-neutral not-invited copy`,async({page},info)=>{
  await base(page);
  await page.route('**/api/v1/auth/email/session',r=>r.fulfill({status:200,json:{status:'ok',identity:{kind,identifier},fresh:true}}));
  await page.goto('/account/');
  await expect(page.getByRole('heading',{name:'Not invited yet'})).toBeVisible();
  await expect(page.locator('main')).toContainText('This account does not have preview access');
  await page.getByRole('button',{name:`Account: ${identifier}`,exact:true}).click();
  const menu=page.getByRole('group',{name:'Account',exact:true});
  await expect(menu).toContainText(identifier);
  await expect(menu).not.toContainText('Cloudflare Access');
  await expect(page.locator('body')).not.toContainText('other-access@example.test');
  await expect(menu.getByRole('button',{name:'Set up a passkey'})).toBeVisible();
  await page.route('**/api/v1/auth/email/logout',r=>r.fulfill({status:500,json:{error:'unavailable'}}));
  await menu.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(menu.getByRole('alert')).toContainText('Could not sign out');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/downloads/r3-wallet-session-${kind}-${info.project.name}.png`});
 });
}
for(const mode of ['500','network','malformed']){
 test(`native ${mode} never falls back to different Access identity/logout`,async({page})=>{
  await base(page);
  await page.route('**/api/v1/auth/email/session',r=>mode==='network'?r.abort():r.fulfill({status:mode==='500'?500:200,json:mode==='500'?{error:'internal_error'}:{status:'ok',identity:{kind:'passkey',identifier:'privatecredential'}}}));
  await page.goto('/account/');
  await expect(page.locator('main').getByRole('alert')).toContainText('Your sign-in could not be checked');
  await page.getByRole('button',{name:'Account',exact:true}).click();
  const menu=page.getByRole('group',{name:'Account',exact:true});
  await expect(menu).toContainText('Your sign-in could not be checked');
  await expect(menu.getByRole('button',{name:'Sign out'})).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('other-access@example.test');
 });
}

test('explicit disabled503 retains legacy Access fallback',async({page})=>{
 await base(page);
 await page.route('**/api/v1/auth/email/session',r=>r.fulfill({status:503,json:{error:'unavailable'}}));
 await page.goto('/account/');
 await page.getByRole('button',{name:'Account: other-access@example.test',exact:true}).click();
 await expect(page.getByRole('group',{name:'Account',exact:true})).toContainText('Signed in via Cloudflare Access');
});
