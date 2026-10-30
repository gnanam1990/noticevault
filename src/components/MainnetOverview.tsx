import React,{useEffect,useState} from 'react';
import {formatUnits} from 'viem';
import {FACTORY,readPublicMainnet,snapshotIsFresh,type MainnetSnapshot} from '../backend/public-mainnet';

export function MainnetOverview({onWorkspace}:{onWorkspace:()=>void}){
 const [snapshot,setSnapshot]=useState<MainnetSnapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[attempt,setAttempt]=useState(0),[clock,setClock]=useState(Date.now());
 useEffect(()=>{const controller=new AbortController();setBusy(true);setError('');setSnapshot(null);void readPublicMainnet(controller.signal).then(value=>{if(!controller.signal.aborted){setSnapshot(value);setClock(Date.now());}}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error&&e.name!=='AbortError'?e.message:'Mainnet read timed out. Try again.');}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});return()=>controller.abort();},[attempt]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),15_000);return()=>clearInterval(timer);},[]);
 const fresh=snapshot&&snapshotIsFresh(snapshot,clock);
 return <main id="main-content" tabIndex={-1} className="nv-page">
  <p className="nv-eyebrow">ARC MAINNET · READ ONLY</p><h1 className="nv-page-title">Your agreements. Grounded in real data.</h1>
  <p className="nv-subtitle">Check the deployed factory without connecting a wallet. Your private agreements and drafts are in your workspace.</p>
  <div className="nv-card mt-6"><div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-xl font-semibold">Mainnet factory</h2><button className="min-h-11 rounded-lg border border-slate-400 px-4 py-2 disabled:opacity-50" disabled={busy} onClick={()=>setAttempt(x=>x+1)}>Refresh chain data</button></div>
   <a className="mt-3 block break-all text-teal-700 underline" href={`https://explorer.arc.io/address/${FACTORY}`} target="_blank" rel="noreferrer">{FACTORY}</a>
   <p className="mt-3 text-sm text-slate-600">Deployment verified on 29 October 2026. Current facts below come from one public Blockdaemon RPC on chain 5042; they do not authorize transactions.</p>
   <div role="status" aria-live="polite" className="mt-5">{busy?'Reading mainnet…':error?`Chain data unavailable: ${error}`:fresh?'Contract code and identity match the deployment record.':'Snapshot expired. Refresh to check current chain state.'}</div>
   {snapshot&&<><dl className="mt-6 grid gap-4 sm:grid-cols-3">{[['Factory liability',`${formatUnits(snapshot.outstandingLiability,6)} USDC`],['Factory cap',`${formatUnits(snapshot.factoryCap,6)} USDC`],['Per-agreement cap',`${formatUnits(snapshot.agreementCap,6)} USDC`]].map(([label,value])=><div key={label} className="rounded-xl bg-slate-50 p-4"><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-2 text-xl font-semibold">{value}</dd></div>)}</dl>
    <p className="mt-5">Creation paused on-chain: {snapshot.creationPaused?'Yes':'No'}. Application financial execution remains disabled.</p>
    <p className="mt-3 text-sm text-slate-600">{fresh?'Observed':'Historical snapshot'} at block <a className="underline" href={`https://explorer.arc.io/block/${snapshot.blockNumber}`} target="_blank" rel="noreferrer">{snapshot.blockNumber}</a> · {new Date(snapshot.blockTime).toUTCString()}. Factory liability is not your wallet balance or your agreement count.</p></>}
  </div>
  <div className="nv-card mt-6"><h2 className="text-xl font-semibold">Your workspace</h2><p className="my-4 text-slate-600">Connect your wallet for account access, then sign in separately when the backend network is available. No sample agreements are shown here.</p><button className="min-h-11 rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white" onClick={onWorkspace}>Open your workspace</button><p className="mt-4 text-sm text-slate-600">The public-site wallet warning remains unresolved. Do not bypass a wallet security warning.</p></div>
 </main>;
}
