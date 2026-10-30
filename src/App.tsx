import React, {useState} from 'react';
import {ShieldCheck, ArrowUpRight, SlidersHorizontal} from 'lucide-react';
import {DraftReview} from './backend/DraftReview.js';
import {DemoProvider, useDemoStore} from './demo/DemoStore.js';
import {SimBanner} from './components/SimBanner.js';
import {Sidebar} from './components/Sidebar.js';
import {MobileNav, MobileControls} from './components/MobileNav.js';
import {StorageErrorBanner} from './components/StorageErrorBanner.js';
import {Overview} from './components/Overview.js';
import {AgreementsList} from './components/AgreementsList.js';
import {AgreementDetail} from './components/AgreementDetail.js';
import {NewDraft} from './components/NewDraft.js';
import {ActivityLog} from './components/ActivityLog.js';
import {ReadinessChecklist} from './components/ReadinessChecklist.js';
import {MainnetOverview} from './components/MainnetOverview.js';
import {MainnetStatus} from './components/MainnetStatus.js';

export function WalletRiskNotice(){
 return <aside role="note" aria-label="Wallet safety" className="nv-safety sticky top-0 z-30 max-h-[40vh] overflow-y-auto" style={{fontSize:'0.875rem'}}>
  <div className="min-w-0">
   <p id="wallet-risk-notice" className="font-semibold">Wallet warning unresolved. If your wallet flags this site, stop. Do not bypass the warning.</p>
   <details className="mt-1"><summary className="min-h-[44px] py-2 font-semibold">Wallet safety details</summary><p className="max-w-prose pb-2">Public-site warning clearance has not been verified. Connecting an account does not sign a message or authorize a transaction. Message signing and transactions require separate approvals. Financial execution remains disabled.</p></details>
  </div>
 </aside>;
}
export function WorkspaceView(){
 return <section id="main-content" tabIndex={-1} aria-label="Workspace" aria-describedby="wallet-risk-notice" className="[&_:is(button,input,select,textarea,a,summary,[tabindex])]:scroll-mt-[calc(40vh_+_1rem)]"><WalletRiskNotice/><DraftReview/></section>;
}

function DemoContent({onAdvanced}:{onAdvanced:()=>void}) {
 const {state}=useDemoStore();
 const panel=state.view==='agreements'?<AgreementsList/>:state.view==='detail'?<AgreementDetail/>:state.view==='new-draft'?<NewDraft/>:state.view==='activity'?<ActivityLog/>:state.view==='readiness'?<ReadinessChecklist onOwner={onAdvanced}/>:<Overview/>;
 return <div className="nv-demo"><SimBanner/><MobileControls/><div className="flex flex-1 min-h-0"><Sidebar/><main className="flex-1 min-w-0 pb-28" id="main-content" tabIndex={-1}><StorageErrorBanner/>{panel}</main></div><MobileNav/></div>;
}
export default function App(){
 const [mode,setMode]=useState<'mainnet'|'demo'|'backend'|'advanced'>('mainnet');
 return <div className="nv-app">
  <a href="#main-content" className="nv-skip">Skip to content</a>
  <header className="nv-header"><div className="nv-brand"><span className="nv-brand-mark"><ShieldCheck size={23} aria-hidden="true"/></span><span>NoticeVault<small>Agreements with a clear way forward</small></span></div>
   <nav aria-label="Application mode" className="nv-mode-nav">
    <button aria-pressed={mode==='mainnet'} onClick={()=>setMode('mainnet')}>Mainnet overview</button>
    <button aria-pressed={mode==='demo'} onClick={()=>setMode('demo')}>Explore demo</button>
    <button aria-pressed={mode==='backend'} onClick={()=>setMode('backend')}>Your workspace <ArrowUpRight size={14} aria-hidden="true"/></button>
    <button aria-pressed={mode==='advanced'} onClick={()=>setMode('advanced')}><SlidersHorizontal size={15} aria-hidden="true"/> Advanced</button>
   </nav>
  </header>
  {mode==='mainnet'&&<MainnetOverview onWorkspace={()=>setMode('backend')}/>}
  {mode==='demo'&&<DemoProvider><DemoContent onAdvanced={()=>setMode('advanced')}/></DemoProvider>}
  {mode==='backend'&&<WorkspaceView/>}
  {mode==='advanced'&&<main id="main-content" tabIndex={-1} className="nv-page"><p className="nv-eyebrow">OWNER &amp; OPERATIONS</p><h1 className="nv-page-title">Deployment &amp; readiness</h1><p className="nv-subtitle">The factory is deployed. Application activation is a separate step.</p><MainnetStatus/><div className="nv-card mt-6"><h2 className="text-xl font-semibold">What remains before real payments</h2><ul className="mt-4 space-y-3 text-slate-600"><li>Resolve the public-site warning and verify its served application bundle.</li><li>Review the mainnet operator configuration, two RPC providers and indexer.</li><li>Complete owner-operated agreement funding with a distinct provider wallet.</li></ul><p className="mt-5 text-sm text-slate-500">No deployment, RPC configuration, journal reset or signing action is available here. The existing factory must not be deployed again.</p></div></main>}
  <footer className="nv-footer">Built with Arc Studio <span>Read-only application · financial execution disabled</span></footer>
 </div>;
}
