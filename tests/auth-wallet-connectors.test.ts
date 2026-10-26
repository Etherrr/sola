import { describe,it,expect,vi } from 'vitest';
import { connectEvm,connectSolana,type MessageProvider } from '../features/auth-v2/wallet-connectors';
import type { Wallet } from '@wallet-standard/base';
const address='0x1111111111111111111111111111111111111111';
function provider(){
 const listeners=new Map<string,Set<()=>void>>();const calls:string[]=[];
 const request=vi.fn(async({method}:Parameters<MessageProvider['request']>[0]):Promise<unknown>=>{
  calls.push(method);return method==='eth_chainId'?'0x1':method==='personal_sign'?'0x'+'11'.repeat(65):[address];
 });
 const p:MessageProvider={request,on(e,fn){if(!listeners.has(e))listeners.set(e,new Set());listeners.get(e)!.add(fn);},removeListener(e,fn){listeners.get(e)?.delete(fn);}};
 return {p,calls,listeners};
}
describe('unmounted message-only EVM adapter',()=>{
 it('connect does not sign or fetch balances; only explicit sign uses personal_sign',async()=>{
  const {p,calls}=provider();const c=await connectEvm(p);
  expect(calls).toEqual(['eth_requestAccounts','eth_chainId']);
  await c.signMessage('Exact server message');
  expect(calls).toEqual(['eth_requestAccounts','eth_chainId','eth_accounts','eth_chainId','personal_sign']);
  expect(p.request).toHaveBeenLastCalledWith({method:'personal_sign',params:['0x457861637420736572766572206d657373616765',address]});
  c.dispose();
 });
 it.each(['accountsChanged','chainChanged','disconnect'])('invalidates pending message on %s',async event=>{
  const {p,calls,listeners}=provider();const c=await connectEvm(p);
  const changed=vi.fn();const off=c.onChange(changed);listeners.get(event)!.forEach(fn=>fn());
  expect(changed).toHaveBeenCalledTimes(1);await expect(c.signMessage('message')).rejects.toThrow('Wallet changed');expect(calls).not.toContain('personal_sign');off();c.dispose();
 });
 it('rejects wrong chain and missing event support without signature',async()=>{
  const {p}=provider();p.request=vi.fn(async()=>['bad']);await expect(connectEvm(p)).rejects.toThrow();
  await expect(connectEvm({request:vi.fn()})).rejects.toThrow('account changes');
 });
});
function solWallet(modify=false){
 let changed:(()=>void)|undefined;
 const account={address:'So11111111111111111111111111111111111111112',publicKey:new Uint8Array(32),chains:['solana:mainnet'],features:['solana:signMessage']};
 const connect=vi.fn(async()=>({accounts:[account]}));
 const signMessage=vi.fn(async(input:{message:Uint8Array})=>[{signedMessage:modify?new Uint8Array([1]):input.message,signature:new Uint8Array(64)}]);
 const off=vi.fn();
 const wallet={name:'Mock',features:{'standard:connect':{connect},'standard:events':{on:(_e:string,fn:()=>void)=>{changed=fn;return off;}},'solana:signMessage':{signMessage}}} as unknown as Wallet;
 return {wallet,connect,signMessage,off,change:()=>changed?.()};
}
describe('unmounted message-only Solana adapter',()=>{
 it('connect shares address only and explicit message signature is exact bytes',async()=>{
  const mock=solWallet();const c=await connectSolana(mock.wallet);expect(mock.signMessage).not.toHaveBeenCalled();
  expect(mock.connect).toHaveBeenCalledWith();expect(await c.signMessage('Exact')).toBe(btoa('\0'.repeat(64)));c.dispose();expect(mock.off).toHaveBeenCalled();
 });
 it('rejects modified signed bytes rather than accepting an unsupported envelope',async()=>{
  const mock=solWallet(true);const c=await connectSolana(mock.wallet);await expect(c.signMessage('Exact')).rejects.toThrow('changed the sign-in message');c.dispose();
 });
 it('account changes block signing and cleanup closes listeners',async()=>{
  const mock=solWallet();const c=await connectSolana(mock.wallet);const cb=vi.fn();c.onChange(cb);mock.change();expect(cb).toHaveBeenCalled();await expect(c.signMessage('Exact')).rejects.toThrow('Wallet changed');c.dispose();
 });
});
