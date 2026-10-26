'use client';
/** Message-only wallet discovery. No automatic connect, RPC reads or transactions. */
import { createStore } from 'mipd';
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
/** Discovery listeners only. Caller must display a choice and invoke connect on click. */
export function discoverWallets(update:(choices:WalletChoice[])=>void):()=>void{
 const evm=createStore();const sol=getWallets();
 const refresh=()=>{
  const choices:WalletChoice[]=[];
  for(const detail of evm.getProviders().slice(0,20)){
   if(!detail.provider||typeof detail.provider.request!=='function')continue;
   choices.push({id:'evm:'+detail.info.uuid,name:String(detail.info.name).slice(0,64),network:'evm',connect:()=>connectEvm(detail.provider as unknown as MessageProvider)});
  }
  for(const wallet of sol.get().slice(0,20)){
   if(!wallet.features['standard:connect']||!wallet.features['solana:signMessage'])continue;
   choices.push({id:'solana:'+choices.length,name:String(wallet.name).slice(0,64),network:'solana',connect:()=>connectSolana(wallet)});
  }
  update(choices);
 };
 const offEvm=evm.subscribe(refresh);const offRegister=sol.on('register',refresh);const offUnregister=sol.on('unregister',refresh);refresh();
 return ()=>{offEvm();offRegister();offUnregister();evm.destroy();};
}
