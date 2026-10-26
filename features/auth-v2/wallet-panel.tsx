'use client';
/** Prepared only: no customer page imports this component until route review. */
import {useEffect,useRef,useState} from 'react';
import {discoverWallets,type WalletChoice} from './wallet-connectors';
import {createWalletFlow,type WalletFlowState,type WalletFlowDeps} from './wallet-flow';
export function WalletPanel({link=false,discover=discoverWallets,deps}:{link?:boolean;discover?:typeof discoverWallets;deps?:WalletFlowDeps}){
 const [choices,setChoices]=useState<WalletChoice[]>([]);
 const [state,setState]=useState<WalletFlowState>({kind:'idle'});
 const [started,setStarted]=useState(false);
 const flow=useRef<ReturnType<typeof createWalletFlow>|null>(null);
 useEffect(()=>{const f=createWalletFlow(setState,deps);flow.current=f;return ()=>{f.dispose();flow.current=null;};},[deps]);
 useEffect(()=>{if(!started)return;return discover(setChoices);},[started,discover]);
 const busy=state.kind==='connecting'||state.kind==='signing';
 return <section className="panel" aria-label={link?'Verify and link wallet':'Wallet sign-in'}>
  <h2>{link?'Verify and link a wallet':'Sign in with a wallet'}</h2>
  <p>Read-only. No transactions, token approvals, seed phrases or private keys.</p>
  <p>Connecting shares a public address. Only a separate message signature proves control. Preview access still needs an invitation.</p>
  {!link&&<p>A wallet-only account has no email recovery. Losing access to the wallet can mean losing access to this account. Add a passkey after signing in.</p>}
  {!started?<button type="button" className="button secondary" onClick={()=>setStarted(true)}>Find wallets</button>:<>
   {choices.length===0&&<p>No supported browser wallet found. This preview supports Ethereum mainnet message signing and Solana software-wallet raw message signing. Contract wallets and transaction-only hardware wallets are not supported. You can use email instead.</p>}
   {choices.map(choice=><button type="button" className="button secondary" key={choice.id} disabled={busy} onClick={()=>void flow.current?.connect(choice)}>{choice.name} ({choice.network==='evm'?'Ethereum':'Solana'})</button>)}
  </>}
  {(state.kind==='connected'||state.kind==='signing')&&<p>Selected public address: <span style={{overflowWrap:'anywhere'}}>{state.address}</span>. Not yet verified for this step.</p>}
  {state.kind==='connected'&&<button type="button" className="button primary" onClick={()=>void flow.current?.sign(link)}>{link?'Sign message to verify and link':'Sign message to sign in'}</button>}
  {busy&&<p role="status">{state.kind==='connecting'?'Waiting for wallet connection...':'Waiting for the message step...'}</p>}
  {state.kind==='error'&&<p role="alert">{state.message} Connect again before trying.</p>}
  {state.kind==='done'&&<p role="status">{state.linked?'Wallet verified and linked. Reload your address book to see it.':'Signed in. Continue to your portfolio.'} {!state.linked&&<a href="/account/overview">Continue</a>}</p>}
  {started&&<button type="button" className="button secondary" onClick={()=>flow.current?.disconnect()}>Clear wallet selection</button>}
 </section>;
}
