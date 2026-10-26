import {describe,it,expect,vi} from 'vitest';
import {createWalletFlow,type WalletFlowState} from '../features/auth-v2/wallet-flow';
import type {PublicWalletConnection,WalletChoice} from '../features/auth-v2/wallet-connectors';
const address='0x1111111111111111111111111111111111111111';
const message=()=>`preview.test wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Sola.\n\nURI: https://preview.test/sign-in\nVersion: 1\nChain ID: 1\nNonce: ${'a'.repeat(48)}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${new Date(Date.now()+60000).toISOString()}`;
function setup(){
 const states:WalletFlowState[]=[];let changed:()=>void=()=>{};
 const connection:PublicWalletConnection={network:'evm',address,signMessage:vi.fn(async()=> '0x'+'11'.repeat(65)),onChange(fn){changed=fn;return ()=>{};},dispose:vi.fn()};
 const choice:WalletChoice={id:'fixture',name:'Fixture',network:'evm',connect:vi.fn(async()=>connection)};
 const request=vi.fn(async(_chain:string,action:string)=>new Response(JSON.stringify(action==='challenge'?{message:message()}:{status:'ok'}),{status:200}));
 const flow=createWalletFlow(s=>states.push(s),{request,origin:()=> 'https://preview.test'});
 return {flow,states,request,connection,choice,change:()=>changed()};
}
describe('unmounted explicit wallet flow',()=>{
 it('connection alone never creates a challenge/signature/account/provider lookup',async()=>{
  const s=setup();await s.flow.connect(s.choice);expect(s.request).not.toHaveBeenCalled();expect(s.connection.signMessage).not.toHaveBeenCalled();expect(s.states.at(-1)?.kind).toBe('connected');s.flow.dispose();
 });
 it('only explicit sign obtains one challenge, one message signature and verifies',async()=>{
  const s=setup();await s.flow.connect(s.choice);await s.flow.sign(false);expect(s.request.mock.calls.map(c=>c[1])).toEqual(['challenge','verify']);expect(s.connection.signMessage).toHaveBeenCalledTimes(1);expect(s.states.at(-1)).toEqual({kind:'done',linked:false});s.flow.dispose();
 });
 it('freshChallengeRequired never replays the old signature; another click gets a new challenge',async()=>{
  const s=setup();s.request.mockImplementation(async(_chain,action)=>new Response(JSON.stringify(action==='challenge'?{message:message()}:{error:'unavailable',freshChallengeRequired:true}),{status:action==='challenge'?200:503}));
  await s.flow.connect(s.choice);await s.flow.sign(true);expect(s.states.at(-1)).toMatchObject({kind:'error',message:expect.stringContaining('new message')});await s.flow.sign(true);expect(s.request.mock.calls.map(c=>c[1])).toEqual(['challenge','verify','challenge','verify']);s.flow.dispose();
 });
 it('changed wallet while challenge awaits prevents any signature or verify',async()=>{
  const s=setup();let resolve:(r:Response)=>void=()=>{};s.request.mockImplementation(()=>new Promise(r=>{resolve=r;}));await s.flow.connect(s.choice);const signing=s.flow.sign(false);s.change();resolve(new Response(JSON.stringify({message:message()})));await signing;expect(s.connection.signMessage).not.toHaveBeenCalled();expect(s.request).toHaveBeenCalledTimes(1);s.flow.dispose();
 });
 it('rejects foreign challenge without asking wallet to sign',async()=>{
  const s=setup();s.request.mockImplementation(async()=>new Response(JSON.stringify({message:message().replaceAll('preview.test','evil.test')})));await s.flow.connect(s.choice);await s.flow.sign(false);expect(s.connection.signMessage).not.toHaveBeenCalled();expect(s.states.at(-1)?.kind).toBe('error');s.flow.dispose();
 });
 it('duplicate sign clicks do not create parallel challenges',async()=>{
  const s=setup();await s.flow.connect(s.choice);await Promise.all([s.flow.sign(false),s.flow.sign(false)]);expect(s.request.mock.calls.map(c=>c[1])).toEqual(['challenge','verify']);s.flow.dispose();
 });
 it('disposal during connect discards and disposes a late connection',async()=>{
  const s=setup();let resolve:(c:PublicWalletConnection)=>void=()=>{};s.choice.connect=()=>new Promise(r=>{resolve=r;});const connecting=s.flow.connect(s.choice);s.flow.dispose();resolve(s.connection);await connecting;expect(s.connection.dispose).toHaveBeenCalled();expect(s.states.at(-1)?.kind).toBe('connecting');
 });
 it('rejects injected statement text before asking any wallet to sign',async()=>{
  const s=setup();s.request.mockImplementation(async()=>new Response(JSON.stringify({message:message().replace('Sign in to Sola.','Approve everything.')})));await s.flow.connect(s.choice);await s.flow.sign(false);expect(s.connection.signMessage).not.toHaveBeenCalled();s.flow.dispose();
 });

 it.each(['before-sign','during-sign'])('discovery removal invalidates exact selected wallet %s',async phase=>{
  const s=setup();await s.flow.connect(s.choice);
  if(phase==='before-sign'){s.flow.invalidate();await s.flow.sign(false);expect(s.request).not.toHaveBeenCalled();}
  else{let resolve:(x:string)=>void=()=>{};s.connection.signMessage=()=>new Promise(r=>{resolve=r;});const signing=s.flow.sign(false);await new Promise(r=>setTimeout(r,0));s.flow.invalidate();resolve('signature');await signing;expect(s.request).toHaveBeenCalledTimes(1);}
  s.flow.dispose();
 });
 it('ambiguous verify network failure locks retry until account reconciliation',async()=>{
  const s=setup();s.request.mockImplementation(async(_chain,action)=>{if(action==='verify')throw Error('network');return new Response(JSON.stringify({message:message()}));});
  await s.flow.connect(s.choice);await s.flow.sign(true);expect(s.states.at(-1)).toEqual({kind:'uncertain',linked:true});s.flow.disconnect();await s.flow.sign(true);expect(s.request).toHaveBeenCalledTimes(2);s.flow.dispose();
 });
 it('clearing during verification cannot imply cancellation or trigger another proof',async()=>{
  const s=setup();let resolve:(r:Response)=>void=()=>{};s.request.mockImplementation(async(_chain,action)=>action==='challenge'?new Response(JSON.stringify({message:message()})):new Promise(r=>{resolve=r;}));
  await s.flow.connect(s.choice);const signing=s.flow.sign(true);await new Promise(r=>setTimeout(r,0));expect(s.states.at(-1)?.kind).toBe('verifying');s.flow.disconnect();expect(s.states.at(-1)?.kind).toBe('verifying');s.flow.invalidate();expect(s.states.at(-1)).toEqual({kind:'uncertain',linked:true});resolve(new Response(JSON.stringify({status:'ok'})));await signing;expect(s.states.at(-1)?.kind).toBe('uncertain');s.flow.dispose();
 });

 it.each([200,302,401,503])('unrecognized verify %s response stays uncertain on repeated invalidation',async status=>{
  const s=setup();s.request.mockImplementation(async(_chain,action)=>action==='challenge'?new Response(JSON.stringify({message:message()})):new Response('<html>unexpected</html>',{status}));
  await s.flow.connect(s.choice);await s.flow.sign(true);expect(s.states.at(-1)).toEqual({kind:'uncertain',linked:true});s.flow.invalidate();s.flow.invalidate();s.change();s.flow.disconnect();await s.flow.connect(s.choice);await s.flow.sign(true);expect(s.states.at(-1)).toEqual({kind:'uncertain',linked:true});expect(s.request).toHaveBeenCalledTimes(2);s.flow.dispose();
 });

});
