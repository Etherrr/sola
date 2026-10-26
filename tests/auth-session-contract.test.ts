import { describe,it,expect } from 'vitest';
import { parseNativeSession } from '../features/auth-v2/session-contract';
describe('native session display contract',()=>{
 it('keeps older deployed email answers compatible',()=>{
  expect(parseNativeSession({status:'ok',email:'test@example.test',fresh:true})).toMatchObject({kind:'ok',email:'test@example.test',displayLabel:'test@example.test',fresh:true});
 });
 it.each([
  ['wallet_evm','0x1111111111111111111111111111111111111111'],
  ['wallet_solana','So11111111111111111111111111111111111111112'],
 ])('keeps %s display separate from email', (kind,identifier)=>{
  expect(parseNativeSession({status:'ok',identity:{kind,identifier},email:'stale@example.test'})).toEqual({kind:'ok',identity:{kind,identifier},displayLabel:identifier,email:null,fresh:false});
 });
 it.each([null,{}, {status:'ok'}, {status:'ok',identity:{kind:'passkey',identifier:'credential'}},
  {status:'ok',identity:{kind:'email',identifier:''}},
  {status:'ok',identity:{kind:'wallet_evm',identifier:'bad'}},
  {status:'ok',identity:{kind:'wallet_solana',identifier:'0'.repeat(32)}},
  {status:'ok',identity:{kind:'email',identifier:'notanemail'}},
  {status:'ok',identity:{kind:'email',identifier:'x'.repeat(255)}}
 ])('rejects malformed or credential identity %#',value=>expect(parseNativeSession(value)).toBeNull());
});
