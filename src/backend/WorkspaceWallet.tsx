import {invalidateWalletSelection} from './wallet-selection';
import React,{useEffect,useRef,useState} from 'react';
import {discoverOwnerWallets,OwnerWalletSession,walletFailure,type WalletChoice,type WalletStatus} from './owner-wallet-session';
import type {InjectedProvider} from './injected-wallet';
import type {AuthNetwork} from './auth-network';
type Props={network:AuthNetwork|null;disabled:boolean;onProvider:(provider:InjectedProvider|undefined)=>void;onStatus:(status:WalletStatus|null)=>void};
const button='min-h-11 rounded-lg border border-slate-400 px-4 py-3 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-600';
export function WorkspaceWallet({network,disabled,onProvider,onStatus}:Props){
 const [choices,setChoices]=useState<readonly WalletChoice[]>([]),[selected,setSelected]=useState(''),[status,setStatus]=useState<WalletStatus|null>(null),[message,setMessage]=useState('Find a wallet, select it, then check its status or connect.'),[busy,setBusy]=useState(false);
 const handles=useRef<{discovery:ReturnType<typeof discoverOwnerWallets>|null;session:OwnerWalletSession|null}>({discovery:null,session:null}),epoch=useRef(0),mounted=useRef(false),running=useRef(false);
 const callbacks=useRef({onProvider,onStatus});useEffect(()=>{callbacks.current={onProvider,onStatus};},[onProvider,onStatus]);
 useEffect(()=>{mounted.current=true;const active=handles.current;const generation=epoch;active.discovery=discoverOwnerWallets(window,setChoices);return()=>{mounted.current=false;generation.current+=1;active.session?.dispose();active.discovery?.dispose();};},[]);
 function clear(){setStatus(null);callbacks.current.onStatus(null);}
 function select(id:string){if(disabled||running.current)return;invalidateWalletSelection();++epoch.current;handles.current.session?.dispose();clear();setSelected(id);const choice=choices.find(c=>c.id===id);callbacks.current.onProvider(choice?.provider);
  handles.current.session=choice?new OwnerWalletSession(choice.provider,()=>{if(!mounted.current)return;++epoch.current;clear();setMessage('Wallet account or network changed. Check wallet status again before signing in.');}):null;
  setMessage(choice?'Wallet selected. Check status without a popup, or Connect to request account access.':'Select a wallet.');
 }
 async function inspect(connect:boolean){const active=handles.current.session;if(!active||disabled||running.current)return;const ticket=++epoch.current;running.current=true;setBusy(true);clear();setMessage(connect?'Open your wallet extension to approve account access. No signature or transaction is requested.':'Reading existing account access and network; no popup is requested.');
  try{const pending=connect?active.connect():active.status();const result=await pending;if(!mounted.current||active!==handles.current.session)return;
   // A connection may emit accountsChanged; the subsequent status is fresh, while sign-in authority is still absent.
   if(!connect&&ticket!==epoch.current)return;setStatus(result);callbacks.current.onStatus(result);
   setMessage(result.accounts.length?'Wallet connected. An already-authorized account may connect without a popup. You are not signed in yet.':'No account is shared with this page. Use Connect wallet and approve account access yourself.');
  }catch(e){if(mounted.current&&active===handles.current.session)setMessage(walletFailure(e));}
  finally{running.current=false;if(mounted.current)setBusy(false);}
 }
 const mismatch=status&&network&&status.chainId!==BigInt(network.chainId);
 return <section aria-label="Wallet connection" className="my-6 rounded-xl border border-slate-200 bg-white p-5">
  <h2 className="text-xl font-bold">1. Connect your wallet</h2>
  <p className="my-3">{network?<>Workspace network: <strong>{network.label} (chain {network.chainId})</strong>. {network.chainId===5042002?'This is the testnet workspace, not mainnet acceptance.':'Mainnet authentication does not prove contracts are deployed or financial execution is enabled.'}</>:<>Workspace network unavailable. You can connect for account access, but sign-in stays unavailable until the backend network is verified.</>}</p>
  <p className="my-3">Connection shares an account only. Sign-in is a separate message approval below.</p>
  <button type="button" className={button} disabled={busy||disabled} onClick={()=>{handles.current.discovery?.refresh();setMessage('Choose a discovered wallet. If none appears, open this app in a wallet-enabled browser.');}}>Find available wallets</button>
  <label className="my-3 block">Wallet<select aria-label="Wallet" value={selected} disabled={busy||disabled} onChange={e=>select(e.target.value)} className="mt-1 min-h-11 w-full rounded border border-slate-400 p-2"><option value="">Select a wallet</option>{choices.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
  {!choices.length&&<p className="my-3">No wallet discovered yet. Desktop: use your installed extension. Mobile: use your wallet's browser; this app does not currently provide a WalletConnect QR/deep-link connector.</p>}
  <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={!selected||busy||disabled} onClick={()=>void inspect(true)}>Connect wallet (account access only)</button><button type="button" className={button} disabled={!selected||busy||disabled} onClick={()=>void inspect(false)}>Check wallet status (read only)</button></div>
  <p role="status" aria-live="polite" className="mt-3 break-words">{message}</p>
  {status&&<div className="mt-3 break-words"><p>Current chain: {String(status.chainId)}. Expected workspace chain: {network?.chainId??'Unavailable'}.</p><p>Account: {status.accounts[0]??'No account shared'}</p>{mismatch&&network&&<p role="alert">Wrong network for this workspace. Select {network.label} (chain {network.chainId}) for this exact page in your wallet, then check status again. No automatic network switch is performed.</p>}</div>}
 </section>;
}
