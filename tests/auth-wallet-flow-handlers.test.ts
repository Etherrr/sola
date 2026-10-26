/** Actual controller -> actual handlers -> local SQLite; synthetic in-process keys only. */
import {describe,it,expect} from 'vitest';
import {createWalletFlow,type WalletFlowState} from '../features/auth-v2/wallet-flow';
import type {WalletChoice} from '../features/auth-v2/wallet-connectors';
import {handleWalletChallenge,handleWalletVerify,handleWalletLinkChallenge,handleWalletLinkVerify} from '../server/auth/wallet';
import {handleNativeSessionInfo} from '../server/auth/session-info';
import {requireEntitledSession} from '../server/auth/guards';
import {createSqliteD1} from './helpers/d1-sqlite';
import {secp256k1} from '@noble/curves/secp256k1';
import {ed25519} from '@noble/curves/ed25519';
import {keccak_256} from '@noble/hashes/sha3';
import {personalSignDigest,toEip55} from '../server/auth/siwe';
import {createSession} from '../server/auth/sessions';
import {SESSION_COOKIE} from '../server/auth/email';
const b58=(bytes:Uint8Array)=>{let n=0n;for(const b of bytes)n=n*256n+BigInt(b);let s='';const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const b of bytes){if(b===0)s='1'+s;else break;}return s;};
for(const network of ['evm','solana'] as const){
 describe(`actual local flow+handlers ${network}`,()=>{
  for(const link of [false,true])it(link?'links to fresh native session and actual verified book':'creates native session but never grants invitation',async()=>{
   const {db,raw}=createSqliteD1();const env={NATIVE_AUTH_ENABLED:'true',PORTFOLIO_ACCOUNTS_DB:db};
   const priv=network==='evm'?secp256k1.utils.randomPrivateKey():ed25519.utils.randomPrivateKey();
   const address=network==='evm'?toEip55('0x'+Buffer.from(keccak_256(secp256k1.getPublicKey(priv,false).slice(1)).slice(-20)).toString('hex')):b58(ed25519.getPublicKey(priv));
   let cookie='';if(link){const now=new Date().toISOString();raw.prepare("INSERT INTO users VALUES ('owner','active',?,?)").run(now,now);const s=await createSession(db,'owner');cookie=SESSION_COOKIE+'='+s.id;}
   const choices:WalletChoice={id:'synthetic',name:'Synthetic local signer',network,connect:async()=>({network,address,onChange:()=>()=>{},dispose:()=>{},signMessage:async message=>{
    if(network==='solana')return Buffer.from(ed25519.sign(new TextEncoder().encode(message),priv)).toString('base64');
    const sig=secp256k1.sign(personalSignDigest(message),priv);return '0x'+Buffer.from(sig.toCompactRawBytes()).toString('hex')+(sig.recovery!+27).toString(16).padStart(2,'0');
   }})};
   const states:WalletFlowState[]=[];const calls:string[]=[];
   const flow=createWalletFlow(s=>states.push(s),{origin:()=> 'https://preview.test',request:async(chain,action,isLink,body)=>{
    calls.push(action);const req=new Request('https://preview.test/api/v1/auth/wallet/'+chain+'/'+action,{method:'POST',headers:{origin:'https://preview.test','content-type':'application/json',cookie},body:JSON.stringify(body)});
    const handler=isLink?(action==='challenge'?handleWalletLinkChallenge:handleWalletLinkVerify):(action==='challenge'?handleWalletChallenge:handleWalletVerify);
    const result=await handler(req,env,chain);if(result.headers.get('set-cookie'))cookie=result.headers.get('set-cookie')!.split(';')[0];return result;
   }});
   await flow.connect(choices);expect(calls).toEqual([]);expect(raw.prepare('SELECT count(*) n FROM auth_identities').get()).toMatchObject({n:0});
   await flow.sign(link);expect(states.at(-1)).toEqual({kind:'done',linked:link});expect(calls).toEqual(['challenge','verify']);
   if(link){expect(raw.prepare('SELECT user_id FROM auth_identities').get()).toMatchObject({user_id:'owner'});expect(raw.prepare('SELECT verification FROM portfolio_addresses').get()).toMatchObject({verification:'verified'});}
   const req=new Request('https://preview.test/api/v1/auth/email/session',{headers:{cookie}});
   expect((await handleNativeSessionInfo(req,env)).status).toBe(200);
   const denied=await requireEntitledSession(req,db);expect(denied).toBeInstanceOf(Response);expect((denied as Response).status).toBe(403);
   flow.dispose();raw.close();
  });
 });
}
