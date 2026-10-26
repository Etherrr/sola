import { describe,it,expect } from 'vitest';
import { createSqliteD1 } from './helpers/d1-sqlite';
import { handleWalletChallenge,handleWalletVerify,handleWalletLinkChallenge,handleWalletLinkVerify } from '../server/auth/wallet';
import { readWalletBody,walletOrigin } from '../server/auth/wallet-request';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { personalSignDigest,toEip55 } from '../server/auth/siwe';
import { createSession } from '../server/auth/sessions';
import { SESSION_COOKIE } from '../server/auth/email';
const origin='https://preview.test';
const key=secp256k1.utils.randomPrivateKey();
const address=toEip55('0x'+Buffer.from(keccak_256(secp256k1.getPublicKey(key,false).slice(1)).slice(-20)).toString('hex'));
const post=(body:unknown,extra:Record<string,string>={})=>new Request(origin+'/api/v1/auth/wallet/evm/challenge',{method:'POST',headers:{origin,'content-type':'application/json','cf-connecting-ip':'192.0.2.1',...extra},body:JSON.stringify(body)});
const sign=(message:string)=>{const s=secp256k1.sign(personalSignDigest(message),key);return '0x'+Buffer.from(s.toCompactRawBytes()).toString('hex')+(s.recovery!+27).toString(16).padStart(2,'0');};
describe('wallet pre-mount request hardening',()=>{
 it('requires exact HTTPS origin (not same-host HTTP/path/null)',()=>{
  for(const o of ['http://preview.test','https://preview.test/path','null','https://evil.test']) expect(walletOrigin(post({}, {origin:o}))?.status).toBe(403);
  expect(walletOrigin(post({}))).toBeNull();
 });
 it.each(['declared','streamed','unicode'])('bounds raw body bytes before JSON: %s',async mode=>{
  const r=mode==='declared'?post({}, {'content-length':'9999'}):post({data:(mode==='unicode'?'金':'x').repeat(mode==='unicode'?1500:4200)});
  expect((await readWalletBody(r) as Response).status).toBe(413);
 });
 it('rejects non-object and non-json payloads',async()=>{
  expect((await readWalletBody(post([])) as Response).status).toBe(400);
  expect((await readWalletBody(post({}, {'content-type':'text/plain'})) as Response).status).toBe(415);
 });
 it('one IP budget covers both chains AND sign-in/link AND challenge/verify',async()=>{
  const {db,raw}=createSqliteD1();const env={NATIVE_AUTH_ENABLED:'true',PORTFOLIO_ACCOUNTS_DB:db};
  const now=new Date().toISOString();raw.prepare("INSERT INTO users VALUES ('u','active',?,?)").run(now,now);
  const session=await createSession(db,'u');const headers={cookie:SESSION_COOKIE+'='+session.id};
  const handlers=[handleWalletChallenge,handleWalletVerify,handleWalletLinkChallenge,handleWalletLinkVerify];
  for(let i=0;i<30;i++)expect((await handlers[i%4](post({},headers),env,i%2?'solana':'evm')).status).not.toBe(429);
  for(const handler of handlers)expect((await handler(post({},headers),env,'solana')).status).toBe(429);
  expect(raw.prepare('SELECT count(*) n FROM challenges').get()).toMatchObject({n:0});raw.close();
 });
 it('limiter storage failure is fail-closed before challenge creation',async()=>{
  const {db,raw}=createSqliteD1();raw.exec('DROP TABLE rate_counters');
  expect((await handleWalletChallenge(post({address}),{NATIVE_AUTH_ENABLED:'true',PORTFOLIO_ACCOUNTS_DB:db},'evm')).status).toBe(429);
  expect(raw.prepare('SELECT count(*) n FROM challenges').get()).toMatchObject({n:0});raw.close();
 });
 it('sets no-store and signs the actual /sign-in URI',async()=>{
  const {db,raw}=createSqliteD1();const r=await handleWalletChallenge(post({address}),{NATIVE_AUTH_ENABLED:'true',PORTFOLIO_ACCOUNTS_DB:db},'evm');
  expect(r.headers.get('cache-control')).toBe('no-store');expect((await r.json()).message).toContain('URI: https://preview.test/sign-in');raw.close();
 });
});
describe('wallet creation atomicity and burned challenge',()=>{
 for(const table of ['users','auth_identities','wallet_links','sessions']){
  it(`injected ${table} failure gives no cookie, burns nonce, and has expected residue`,async()=>{
   const {db,raw}=createSqliteD1();const env={NATIVE_AUTH_ENABLED:'true',PORTFOLIO_ACCOUNTS_DB:db};
   const c=await handleWalletChallenge(post({address}),env,'evm');const {message}=await c.json() as {message:string};
   raw.exec(`CREATE TRIGGER fail_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'forced'); END`);
   const r=await handleWalletVerify(post({address,message,signature:sign(message)}),env,'evm');
   expect(r.status).toBe(503);expect(r.headers.get('set-cookie')).toBeNull();
   for(const t of ['users','auth_identities','wallet_links'])expect(raw.prepare(`SELECT count(*) n FROM ${t}`).get()).toMatchObject({n:table==='sessions'?1:0});
   expect(raw.prepare('SELECT count(*) n FROM sessions').get()).toMatchObject({n:0});
   expect(raw.prepare('SELECT count(*) n FROM challenges WHERE consumed_at IS NOT NULL').get()).toMatchObject({n:1});
   raw.exec('DROP TRIGGER fail_insert');
   expect((await handleWalletVerify(post({address,message,signature:sign(message)}),env,'evm')).status).toBe(401);
   raw.close();
  });
 }
 it.each(['conditional','unique-collision'])('recovers the actual identity winner: %s',async mode=>{
  const {db,raw}=createSqliteD1();const env={NATIVE_AUTH_ENABLED:'true',PORTFOLIO_ACCOUNTS_DB:db};
  const {message}=await (await handleWalletChallenge(post({address}),env,'evm')).json() as {message:string};
  const realBatch=db.batch.bind(db);
  db.batch=async statements=>{
   const now=new Date().toISOString();
   raw.prepare("INSERT INTO users VALUES ('winner','active',?,?)").run(now,now);
   if(mode==='conditional') {
    raw.prepare("INSERT INTO auth_identities (id,user_id,kind,identifier,verified_at) VALUES ('winner-i','winner','wallet_evm',?,?)").run(address.toLowerCase(),now);
    return realBatch(statements);
   }
   // At batch admission the unique identity has been won elsewhere. Inject a
   // conflict before execution to test post-conflict readback, not real D1 concurrency.
   raw.prepare("INSERT INTO auth_identities (id,user_id,kind,identifier,verified_at) VALUES ('winner-i','winner','wallet_evm',?,?)").run(address.toLowerCase(),now);
   throw new Error('UNIQUE constraint failed: auth_identities.kind, auth_identities.identifier');
  };
  const r=await handleWalletVerify(post({address,message,signature:sign(message)}),env,'evm');
  expect(r.status).toBe(200);expect((await r.json()).user.id).toBe('winner');
  expect(raw.prepare('SELECT count(*) n FROM users').get()).toMatchObject({n:1});
  expect(raw.prepare('SELECT user_id FROM sessions').get()).toMatchObject({user_id:'winner'});raw.close();
 });
 it('missing batch capability fails closed without partial new account',async()=>{
  const {db,raw}=createSqliteD1();const env={NATIVE_AUTH_ENABLED:'true',PORTFOLIO_ACCOUNTS_DB:{prepare:db.prepare}};
  const {message}=await (await handleWalletChallenge(post({address}),env,'evm')).json() as {message:string};
  const r=await handleWalletVerify(post({address,message,signature:sign(message)}),env,'evm');
  expect(r.status).toBe(503);expect(r.headers.get('set-cookie')).toBeNull();expect(raw.prepare('SELECT count(*) n FROM users').get()).toMatchObject({n:0});raw.close();
 });
});
