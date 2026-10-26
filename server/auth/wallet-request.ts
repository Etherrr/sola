/** Wallet-only pre-mount bounds. No body buffering beyond the fixed byte cap. */
import type { ChallengeDb } from './challenges';
import { createD1Limiter } from '../accounts/d1-limiter';
const BYTE_CAP = 4096;
export const walletJson = (status: number, body: unknown, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers: {
    'content-type':'application/json', 'cache-control':'no-store', ...headers,
  }});
export function walletOrigin(req: Request): Response | null {
  let origin: URL;
  try { origin = new URL(req.headers.get('origin') ?? ''); }
  catch { return walletJson(403,{error:'origin_required'}); }
  const expected=new URL(req.url);
  if (expected.protocol !== 'https:' || origin.origin !== expected.origin ||
      origin.href !== origin.origin + '/') return walletJson(403,{error:'origin_mismatch'});
  return null;
}
export async function walletAggregateLimit(req:Request,db:ChallengeDb):Promise<Response|null>{
 const ip=req.headers.get('cf-connecting-ip')?.trim();
 const key=ip && ip.length<=64?ip:'__unknown__';
 // ONE scope across sign-in/link, both chains, challenge/verify. Cycling any
 // dimension cannot reset this budget; per-subject limits remain layered below.
 const limit=await createD1Limiter(db as never,[{limit:30,windowMs:600_000},{limit:100,windowMs:86_400_000}],'auth_wallet_aggregate_ip').check(key);
 return limit.allowed?null:walletJson(429,{error:'rate_limited',retryAfterSec:limit.retryAfterSec});
}
export async function readWalletBody(req:Request):Promise<Record<string,unknown>|Response>{
 const declared=req.headers.get('content-length');
 if(declared && (!/^\d+$/.test(declared)||Number(declared)>BYTE_CAP)) return walletJson(413,{error:'request_too_large'});
 if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') return walletJson(415,{error:'json_required'});
 if(!req.body) return walletJson(400,{error:'invalid_request'});
 const reader=req.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
 try {
  for(;;){const {done,value}=await reader.read(); if(done)break;
   size+=value.byteLength;
   if(size>BYTE_CAP){await reader.cancel().catch(() => undefined); return walletJson(413,{error:'request_too_large'});}
   chunks.push(value);
  }
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  const parsed:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)) return walletJson(400,{error:'invalid_request'});
  return parsed as Record<string,unknown>;
 }catch{return walletJson(400,{error:'invalid_request'});}finally{reader.releaseLock();}
}
