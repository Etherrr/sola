import {describe,it,expect,vi,beforeEach} from 'vitest';
const mock=vi.hoisted(()=>({announce:null as null|((v:unknown)=>void),wallets:[] as unknown[],callbacks:new Map<string,()=>void>()}));
vi.mock('mipd',()=>({requestProviders:(fn:(v:unknown)=>void)=>{mock.announce=fn;return ()=>{};}}));
vi.mock('@wallet-standard/app',()=>({getWallets:()=>({get:()=>mock.wallets,on:(e:string,fn:()=>void)=>{mock.callbacks.set(e,fn);return ()=>{};}})}));
import {discoverWallets,type WalletChoice} from '../features/auth-v2/wallet-connectors';
function wallet(name:string){return {name,features:{'standard:connect':{connect:()=>{}},'solana:signMessage':{signMessage:()=>{}},'standard:events':{on:()=>{}}}};}
const provider=()=>({request:()=>{},on:()=>{},removeListener:()=>{}});
beforeEach(()=>{mock.wallets=[];mock.callbacks.clear();mock.announce=null;});
describe('untrusted discovery and stable exact-wallet keys',()=>{
 it('unregister/network arrivals never reassign another wallet key',()=>{
  const a=wallet('A'),b=wallet('B');mock.wallets=[a,b];let choices:WalletChoice[]=[];const stop=discoverWallets(c=>choices=c);
  const aid=choices.find(c=>c.name==='A')!.id,bid=choices.find(c=>c.name==='B')!.id;
  mock.wallets=[b];mock.callbacks.get('unregister')!();expect(choices[0].id).toBe(bid);expect(choices.some(c=>c.id===aid)).toBe(false);
  mock.announce!({info:{uuid:'one',name:'EVM'},provider:provider()});expect(choices.find(c=>c.name==='B')!.id).toBe(bid);
  mock.wallets=[a,b];mock.callbacks.get('register')!();expect(choices.find(c=>c.name==='A')!.id).toBe(aid);stop();
 });
 it('malformed/null/throwing entries are isolated and valid choices survive',()=>{
  mock.wallets=[null,{name:'bad'},Object.defineProperty({},'name',{get(){throw Error('bad');}}),wallet('Good\\u202e')];let choices:WalletChoice[]=[];const stop=discoverWallets(c=>choices=c);
  for(const raw of [null,{}, {provider:provider()},{info:null,provider:provider()},{info:{name:'X',uuid:'x'},provider:{}},Object.defineProperty({},'info',{get(){throw Error('bad');}})])expect(()=>mock.announce!(raw)).not.toThrow();
  expect(choices).toHaveLength(1);mock.announce!({info:{name:'Valid',uuid:'valid'},provider:provider()});expect(choices.map(c=>c.name)).toContain('Valid');stop();
 });
});
