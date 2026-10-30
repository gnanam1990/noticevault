import React,{useEffect,useMemo,useRef,useState} from 'react';
import {loadAuthNetwork,type AuthNetwork} from './auth-network';
import {AuthFlow} from './auth-flow.js';
import {injectedWallet} from './injected-wallet.js';
import {WorkspaceWallet} from './WorkspaceWallet';
import {connectedWorkspaceWallet} from './workspace-wallet';
import type {WalletStatus} from './owner-wallet-session';
import type {InjectedProvider} from './injected-wallet.js';
import type {DraftReviewClient,Session} from './draft-review.js';
type SignInProps={onProvider?:(provider:InjectedProvider|undefined)=>void;onNetwork?:(network:AuthNetwork|null)=>void;api:DraftReviewClient;onSignedIn:(session:Session)=>void;onInvalidated:()=>void;onBusy:(busy:boolean)=>void};
export function SignIn(props:SignInProps){
 const [network,setNetwork]=useState<AuthNetwork|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{props.onNetwork?.(network);},[network,props.onNetwork]);
 useEffect(()=>{const controller=new AbortController();void loadAuthNetwork(controller.signal).then(setNetwork).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Network unavailable');});return()=>controller.abort();},[attempt]);
 if(!network)return <><WorkspaceWallet network={null} disabled={false} onProvider={next=>{props.onInvalidated();props.onProvider?.(next);}} onStatus={()=>{}}/><section aria-label="Wallet sign-in" className="my-6 rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-bold">Sign in to your workspace</h2><p role="status" className="my-3">{error||'Loading the configured Arc network…'}</p>{error&&<button type="button" className="min-h-11 rounded-lg border border-slate-400 px-4 py-3" onClick={()=>{setError('');setAttempt(x=>x+1);}}>Retry network check</button>}<p className="mt-3 text-sm text-slate-600">When the backend becomes available, select your wallet and check its status again before sign-in. Never bypass a wallet security warning.</p></section></>;
 return <NetworkSignIn {...props} network={network}/>;
}
function NetworkSignIn({api,onSignedIn,onInvalidated,onBusy,network,onProvider}:SignInProps&{network:AuthNetwork}){
 const origin=typeof window==='undefined'?'http://localhost':window.location.origin;
 const flow=useMemo(()=>new AuthFlow(api,origin,network.chainId),[api,origin,network.chainId]);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const running=useRef(false),mounted=useRef(true),generation=useRef(0);const invalidate=useRef(onInvalidated);const busyChanged=useRef(onBusy);
 useEffect(()=>{invalidate.current=onInvalidated;busyChanged.current=onBusy;},[onInvalidated,onBusy]);
 const [provider,setProvider]=useState<InjectedProvider|undefined>(),[walletStatus,setWalletStatus]=useState<WalletStatus|null>(null);
 const ready=!!walletStatus?.accounts.length&&walletStatus.chainId===BigInt(network.chainId);
 useEffect(()=>{mounted.current=true;const changed=()=>{if(flow.pending)return;++generation.current;invalidate.current();busyChanged.current(true);setMessage('Wallet changed. Sign in again.');void flow.signOut().catch(()=>{if(mounted.current)setMessage('Session cleanup could not be confirmed. Retry Sign out.');}).finally(()=>{if(mounted.current)busyChanged.current(flow.busy);});};const detach=provider?injectedWallet(provider).onChange?.(changed):undefined;return()=>{mounted.current=false;detach?.();if(running.current)void flow.signOut().catch(()=>{});};},[flow,provider]);
 async function signIn(){
  if(running.current)return;if(flow.busy){setMessage('Session cleanup is pending or unconfirmed. Use Sign out; wallet connection and status remain available.');return;}invalidate.current();
  if(!ready||!walletStatus){setMessage('Connect and check the expected network before signing in.');return;}
  if(!provider){setMessage('No injected wallet is available. Install or open your wallet yourself, then retry.');return;}
  const ticket=++generation.current;running.current=true;setBusy(true);busyChanged.current(true);setMessage('Checking backend session cleanup before requesting a sign-in message. Wallet connection alone is not authentication.');
  try{const wallet=connectedWorkspaceWallet(provider,{address:walletStatus.accounts[0],chainId:network.chainId}),session=await flow.signIn(wallet);const current=await wallet.context();if(current.address.toLowerCase()!==session.address.toLowerCase()||String(current.chainId)!==session.chainId){await flow.signOut();throw new Error('Wallet changed. Sign in again.');}if(mounted.current&&ticket===generation.current){onSignedIn(session);setMessage('Signed in. Your workspaces are available below.');}}
  catch(e){if(mounted.current){invalidate.current();setMessage(e&&typeof e==='object'&&'code' in e&&e.code===4001?'Signing was declined. No session was accepted.':e instanceof Error?e.message:'Sign-in failed. Please retry.');}}
  finally{running.current=false;if(mounted.current){setBusy(false);busyChanged.current(flow.busy);}}
 }
 async function signOut(){++generation.current;invalidate.current();busyChanged.current(true);setMessage(busy?'Cancellation requested. Dismiss any open wallet prompt; its result will not be accepted.':'Signing out…');try{await flow.signOut();if(mounted.current)setMessage('Signed out.');}catch{if(mounted.current)setMessage('Sign-out could not be confirmed. Retry before signing in again.');}finally{if(mounted.current)busyChanged.current(flow.busy);}}
 return <><WorkspaceWallet network={network} disabled={busy} onStatus={setWalletStatus} onProvider={next=>{setWalletStatus(null);invalidate.current();onProvider?.(next);if(provider&&provider!==next)void signOut();setProvider(next);}}/><section aria-label="Wallet sign-in" className="my-6 rounded-xl border border-slate-200 bg-white p-5">
  <h2 className="text-xl font-bold">2. Sign in to your workspace</h2><p className="my-3 text-slate-700">Use your wallet on {network.label} (chain {network.chainId}). Sign-in proves your account; it does not accept an agreement or send a transaction.</p>
  <div className="flex flex-wrap gap-3"><button type="button" disabled={busy||!ready} onClick={()=>void signIn()} className="min-h-11 rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-600">Sign in (message only)</button><button type="button" onClick={()=>void signOut()} className="min-h-11 rounded-lg border border-slate-400 px-4 py-3">{busy?'Cancel sign-in':'Sign out'}</button></div>
  <p role="status" aria-live="polite" className="mt-3 break-words">{message}</p>
 </section></>;
}
