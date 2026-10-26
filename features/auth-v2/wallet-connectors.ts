'use client';
/** Message-only wallet discovery. No automatic connect, RPC reads or transactions. */
import { requestProviders } from 'mipd';
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type { StandardConnectFeature, StandardEventsFeature } from '@wallet-standard/features';
import type { SolanaSignMessageFeature } from '@solana/wallet-standard-features';
export type WalletNetwork = 'evm' | 'solana';
export type PublicWalletConnection = {
  network: WalletNetwork; address: string;
  signMessage(message: string): Promise<string>;
  onChange(listener: () => void): () => void;
  dispose(): void;
};
export type WalletChoice = { id: string; name: string; network: WalletNetwork; connect(): Promise<PublicWalletConnection> };
export type MessageProvider = {
 request(args:{method:'eth_requestAccounts'|'eth_accounts'|'eth_chainId'|'personal_sign';params?:unknown[]}):Promise<unknown>;
 on?(event:string,listener:()=>void):void;
 removeListener?(event:string,listener:()=>void):void;
};
const evmAddress=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v);
const solAddress=(v:unknown):v is string=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const hex=(s:string)=>'0x'+Array.from(new TextEncoder().encode(s),b=>b.toString(16).padStart(2,'0')).join('');
const b64=(bytes:Uint8Array)=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
export async function connectEvm(provider:MessageProvider):Promise<PublicWalletConnection>{
 if(!provider.on||!provider.removeListener)throw new Error('This wallet cannot report account changes safely.');
 const accounts=await provider.request({method:'eth_requestAccounts'});
 if(!Array.isArray(accounts)||!evmAddress(accounts[0]))throw new Error('This wallet did not share a supported address.');
 const address=accounts[0];
 const chain=await provider.request({method:'eth_chainId'});
 if(chain!=='0x1')throw new Error('Switch to Ethereum mainnet in your wallet, then connect again.');
 let changed=false;
 const invalidate=()=>{changed=true;};
 provider.on?.('accountsChanged',invalidate);provider.on?.('chainChanged',invalidate);provider.on?.('disconnect',invalidate);
 return {network:'evm',address,
  async signMessage(message){
   if(changed)throw new Error('Wallet changed. Connect again.');
   const current=await provider.request({method:'eth_accounts'});
   const currentChain=await provider.request({method:'eth_chainId'});
   if(changed||!Array.isArray(current)||typeof current[0]!=='string'||current[0].toLowerCase()!==address.toLowerCase()||currentChain!=='0x1')throw new Error('Wallet changed. Connect again.');
   const signature=await provider.request({method:'personal_sign',params:[hex(message),address]});
   if(changed||typeof signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(signature))throw new Error('The wallet did not return a supported message signature.');
   return signature;
  },
  onChange(listener){
   provider.on?.('accountsChanged',listener);provider.on?.('chainChanged',listener);provider.on?.('disconnect',listener);
   return ()=>{for(const e of ['accountsChanged','chainChanged','disconnect'])provider.removeListener?.(e,listener);};
  },
  dispose(){for(const e of ['accountsChanged','chainChanged','disconnect'])provider.removeListener?.(e,invalidate);changed=true;},
 };
}
export async function connectSolana(wallet:Wallet):Promise<PublicWalletConnection>{
 const connect=wallet.features['standard:connect'] as StandardConnectFeature['standard:connect']|undefined;
 const signer=wallet.features['solana:signMessage'] as SolanaSignMessageFeature['solana:signMessage']|undefined;
 const events=wallet.features['standard:events'] as StandardEventsFeature['standard:events']|undefined;
 if(!connect?.connect||!signer?.signMessage||!events?.on)throw new Error('This wallet does not support the message-only sign-in path.');
 const result=await connect.connect();
 const account:WalletAccount|undefined=result.accounts.find(a=>a.chains.includes('solana:mainnet')&&a.features.includes('solana:signMessage')&&solAddress(a.address));
 if(!account)throw new Error('This wallet did not share a supported Solana account.');
 let changed=false;const listeners=new Set<()=>void>();
 const off=events.on('change',()=>{changed=true;listeners.forEach(fn=>fn());});
 return {network:'solana',address:account.address,
  async signMessage(message){
   if(changed)throw new Error('Wallet changed. Connect again.');
   const bytes=new TextEncoder().encode(message);
   const out=await signer.signMessage({account,message:bytes});const signed=out[0];
   if(changed||out.length!==1||!signed||signed.signature.length!==64||
     (signed.signatureType!==undefined&&signed.signatureType!=='ed25519')||
     signed.signedMessage.length!==bytes.length||!bytes.every((b,i)=>signed.signedMessage[i]===b))throw new Error('This wallet changed the sign-in message or returned an unsupported signature.');
   return b64(signed.signature);
  },
  onChange(listener){listeners.add(listener);return ()=>{listeners.delete(listener);};},
  dispose(){off();listeners.clear();changed=true;},
 };
}
/** Discovery listeners only. Untrusted announcements are validated before storage. */
export function discoverWallets(update:(choices:WalletChoice[])=>void):()=>void{
 const sol=getWallets();
 const providers=new Map<object,{id:string;name:string;provider:MessageProvider}>();
 const keys=new WeakMap<object,string>();let nextId=0;
 const key=(value:object,prefix:string)=>{let id=keys.get(value);if(!id){id=prefix+':'+(++nextId);keys.set(value,id);}return id;};
 const label=(value:unknown)=>typeof value==='string'?Array.from(value).filter(c=>{const n=c.codePointAt(0)!;return n>=32&&!(n>=127&&n<=159)&&!(n>=0x202a&&n<=0x202e)&&!(n>=0x2066&&n<=0x2069);}).join('').trim().slice(0,64):'';
 const refresh=()=>{
  const choices:WalletChoice[]=[];
  for(const detail of providers.values())choices.push({id:detail.id,name:detail.name,network:'evm',connect:()=>connectEvm(detail.provider)});
  for(const value of sol.get().slice(0,20)){
   // A broken wallet entry must never suppress the remaining valid wallets.
   try{
    if(!value||typeof value!=='object')continue;
    const name=label(value.name);const f=value.features;
    if(!name||!f||typeof f!=='object')continue;
    const c=f['standard:connect'] as Partial<StandardConnectFeature['standard:connect']>|undefined;
    const m=f['solana:signMessage'] as Partial<SolanaSignMessageFeature['solana:signMessage']>|undefined;
    const e=f['standard:events'] as Partial<StandardEventsFeature['standard:events']>|undefined;
    if(typeof c?.connect!=='function'||typeof m?.signMessage!=='function'||typeof e?.on!=='function')continue;
    choices.push({id:key(value,'solana'),name,network:'solana',connect:()=>connectSolana(value)});
   }catch{continue;}
  }
  update(choices);
 };
 // mipd.createStore indexes info.uuid before validation. Use its lower-level
 // listener and keep only validated object identities here instead.
 const stop=requestProviders((raw)=>{
  try{
   if(!raw||typeof raw!=='object'||!raw.info||typeof raw.info!=='object'||!raw.provider||typeof raw.provider!=='object')return;
   const p=raw.provider as unknown as MessageProvider;const name=label(raw.info.name);
   if(!name||typeof raw.info.uuid!=='string'||raw.info.uuid.length>128||typeof p.request!=='function'||typeof p.on!=='function'||typeof p.removeListener!=='function')return;
   if(providers.size>=20&&!providers.has(p))return;
   providers.set(p,{id:key(p,'evm'),name,provider:p});refresh();
  }catch{return;}
 });
 const offRegister=sol.on('register',refresh);const offUnregister=sol.on('unregister',refresh);refresh();
 return ()=>{stop?.();offRegister();offUnregister();providers.clear();};
}
