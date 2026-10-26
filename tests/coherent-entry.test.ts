import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
const read=(p:string)=>readFileSync(p,'utf8');
describe('one native account entry without old-list detours',()=>{
 it('removes old-list navigation and signed-out/error recovery detours',()=>{
  for(const path of ['components/app-shell.tsx','app/sign-in/page.tsx','app/create-account/page.tsx','features/auth-v2/account-gate.tsx']) {
   const s=read(path);expect(s).not.toContain('Legacy Track');expect(s).not.toContain('href="/portfolio"');expect(s).not.toContain('legacyLink');
  }
 });
 it('keeps optional import collapsed and explicit, never asserts previous ownership',()=>{
  const s=read('features/claim/claim-section.tsx');expect(s).toContain('<details className="claim-import">');expect(s).toContain('<summary>Import saved addresses</summary>');expect(s).toContain('If you saved addresses before');expect(s).toContain('href="/account/legacy-bridge/"');expect(s).toContain('onClick={() => setApi(makeApi())}');expect(s).not.toContain('<details open');
 });
 it('preserves the saved-bookmark page and real list without promoting a demo',()=>{
  const s=read('app/portfolio/page.tsx');expect(s).toContain('<CombinedWallets />');expect(s).toContain('Nothing moves automatically');expect(s).not.toContain('/demo');expect(s).not.toContain('Legacy Track');
 });
});
