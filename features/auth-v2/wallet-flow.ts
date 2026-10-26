/** Explicit two-action controller, currently not mounted in customer UI. */
import { walletAuthRequest } from '../portfolio/api-client';
import type { WalletChoice, PublicWalletConnection } from './wallet-connectors';
export type WalletFlowState =
 | {kind:'idle'} | {kind:'connecting'}
 | {kind:'connected';address:string;network:'evm'|'solana'}
 | {kind:'signing';address:string} | {kind:'verifying';address:string} | {kind:'uncertain';linked:boolean} | {kind:'done';linked:boolean}
 | {kind:'error';message:string};
export type WalletFlowDeps = { request:typeof walletAuthRequest; origin:()=>string };
const defaults:WalletFlowDeps={request:walletAuthRequest,origin:()=>window.location.origin};
function boundMessage(message:string,network:'evm'|'solana',address:string,origin:string):boolean{
 const url=new URL(origin); const lines=message.split('\n');
 const evm=network==='evm';
 const expectedLength=evm?11:9;
 if(lines.length!==expectedLength||lines[0]!==`${url.host} wants you to sign in with your ${evm?'Ethereum':'Solana'} account:`||
    (evm?lines[1].toLowerCase()!==address.toLowerCase():lines[1]!==address)||
    lines[2]!==''||lines[3]!=='Sign in to Sola.'||lines[4]!==''||lines[5]!==`URI: ${url.origin}/sign-in`)return false;
 const offset=evm?2:0;
 if(evm&&(lines[6]!=='Version: 1'||lines[7]!=='Chain ID: 1'))return false;
 if(!/^Nonce: [a-f0-9]{48}$/.test(lines[6+offset]))return false;
 const issued=lines[7+offset].match(/^Issued At: (.+)$/)?.[1];
 const expiry=lines[8+offset].match(/^Expiration Time: (.+)$/)?.[1];
 const now=Date.now();
 return !!issued&&!!expiry&&Number.isFinite(Date.parse(issued))&&Date.parse(issued)<=now+60000&&
   Date.parse(expiry)>now&&Date.parse(expiry)<=now+11*60000;

}
export function createWalletFlow(update:(state:WalletFlowState)=>void,deps:WalletFlowDeps=defaults){
 let connection:PublicWalletConnection|null=null;let remove:()=>void=()=>{};let version=0;let busy=false;let disposed=false;
 let abort:AbortController|null=null;let verifying=false;let uncertain=false;let activeLink=false;
 const emit=(s:WalletFlowState)=>{if(!disposed)update(s);};
 const clear=()=>{version++;abort?.abort();abort=null;remove();remove=()=>{};connection?.dispose();connection=null;busy=false;};
 return {
  async connect(choice:WalletChoice){
   if(disposed||busy||uncertain)return;clear();const mine=version;busy=true;emit({kind:'connecting'});
   try{
    const next=await choice.connect();
    if(disposed||mine!==version){next.dispose();return;}
    connection=next;remove=next.onChange(()=>{if(uncertain)return;const pending=verifying;clear();if(pending){uncertain=true;emit({kind:'uncertain',linked:activeLink});}else emit({kind:'error',message:'Wallet changed. Connect again.'});});
    busy=false;emit({kind:'connected',address:next.address,network:next.network});
   }catch{if(mine===version){busy=false;emit({kind:'error',message:'Wallet connection was cancelled or could not complete. Nothing was saved.'});}}
  },
  async sign(link:boolean){
   if(disposed||busy||uncertain||!connection)return;
   const current=connection;const mine=version;activeLink=link;busy=true;abort=new AbortController();emit({kind:'signing',address:current.address});
   try{
    const challenge=await deps.request(current.network,'challenge',link,{address:current.address},abort.signal);
    const body=await challenge.json().catch(()=>null) as {message?:unknown;error?:string;freshChallengeRequired?:boolean}|null;
    if(disposed||mine!==version)return;
    if(!challenge.ok||typeof body?.message!=='string'||body.message.length>2048||!boundMessage(body.message,current.network,current.address,deps.origin()))throw new Error('challenge');
    const signature=await current.signMessage(body.message);
    if(disposed||mine!==version)return;
    verifying=true;emit({kind:'verifying',address:current.address});
    const response=await deps.request(current.network,'verify',link,{address:current.address,message:body.message,signature},abort.signal);
    const result=await response.json().catch(()=>null) as {status?:string;error?:string;freshChallengeRequired?:boolean}|null;
    if(disposed||mine!==version)return;
    const recognizedRejection = (response.status===503&&result?.error==='unavailable'&&result.freshChallengeRequired===true)||
      (response.status===401&&['invalid_signature','invalid_or_consumed_challenge','not_authenticated','session_expired'].includes(result?.error??''))||
      (response.status===403&&result?.error==='reauth_required')||
      (response.status===409&&['wallet_linked_elsewhere','too_many_addresses'].includes(result?.error??''))||
      (response.status===429&&['rate_limited','too_many_attempts'].includes(result?.error??''));
    if(!(response.status===200&&result?.status==='ok')&&!recognizedRejection){uncertain=true;busy=false;verifying=false;emit({kind:'uncertain',linked:link});return;}
    verifying=false;
    if(!response.ok||result?.status!=='ok'){
     busy=false;
     const message=result?.freshChallengeRequired?'That sign-in attempt could not finish. Try again for a new message.':response.status===403?'Sign in again before linking a wallet.':response.status===409?'This wallet could not be linked to this account.':response.status===429?'Too many attempts. Wait before trying again.':'The wallet signature could not be verified. Try again for a new message.';
     emit({kind:'error',message});return;
    }
    busy=false;emit({kind:'done',linked:link});
   }catch{if(mine===version&&!disposed){busy=false;if(verifying){uncertain=true;verifying=false;emit({kind:'uncertain',linked:link});}else emit({kind:'error',message:'The message step was cancelled or could not finish. Try again for a new message.'});}}
   // No retry uses the old message/signature; every click gets a new challenge.
  },
  invalidate(){if(uncertain)return;const pending=verifying;clear();if(pending){uncertain=true;verifying=false;emit({kind:'uncertain',linked:activeLink});}else emit({kind:'error',message:'Selected wallet is no longer available. Connect again.'});},
  disconnect(){if(verifying||uncertain)return;clear();emit({kind:'idle'});},
  dispose(){disposed=true;clear();},
 };
}
