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
import {MainnetStatus} from './components/MainnetStatus.js';

function DemoContent({onAdvanced}:{onAdvanced:()=>void}) {
 const {state}=useDemoStore();
 const panel=state.view==='agreements'?<AgreementsList/>:state.view==='detail'?<AgreementDetail/>:state.view==='new-draft'?<NewDraft/>:state.view==='activity'?<ActivityLog/>:state.view==='readiness'?<ReadinessChecklist onOwner={onAdvanced}/>:<Overview/>;
 return <div className="nv-demo"><SimBanner/><MobileControls/><div className="flex flex-1 min-h-0"><Sidebar/><main className="flex-1 min-w-0 pb-28" id="main-content" tabIndex={-1}><StorageErrorBanner/>{panel}</main></div><MobileNav/></div>;
}
export default function App(){
 const [mode,setMode]=useState<'demo'|'backend'|'advanced'>('demo');
 return <div className="nv-app">
  <a href="#main-content" className="nv-skip">Skip to content</a>
  <header className="nv-header"><div className="nv-brand"><span className="nv-brand-mark"><ShieldCheck size={23} aria-hidden="true"/></span><span>NoticeVault<small>Agreements with a clear way forward</small></span></div>
   <nav aria-label="Application mode" className="nv-mode-nav">
    <button aria-pressed={mode==='demo'} onClick={()=>setMode('demo')}>Explore demo</button>
    <button aria-pressed={mode==='backend'} onClick={()=>setMode('backend')}>Your workspace <ArrowUpRight size={14} aria-hidden="true"/></button>
    <button aria-pressed={mode==='advanced'} onClick={()=>setMode('advanced')}><SlidersHorizontal size={15} aria-hidden="true"/> Advanced</button>
   </nav>
  </header>
  <div className="nv-safety" role="note"><span className="nv-safety-dot"/>Public-site wallet warning unresolved. Real-money execution remains disabled.</div>
  {mode==='demo'&&<DemoProvider><DemoContent onAdvanced={()=>setMode('advanced')}/></DemoProvider>}
  {mode==='backend'&&<div id="main-content" tabIndex={-1}><DraftReview/></div>}
  {mode==='advanced'&&<main id="main-content" tabIndex={-1} className="nv-page"><p className="nv-eyebrow">OWNER &amp; OPERATIONS</p><h1 className="nv-page-title">Deployment &amp; readiness</h1><p className="nv-subtitle">The factory is deployed. Application activation is a separate step.</p><MainnetStatus/><div className="nv-card mt-6"><h2 className="text-xl font-semibold">What remains before real payments</h2><ul className="mt-4 space-y-3 text-slate-600"><li>Resolve the public-site warning and verify its served application bundle.</li><li>Review the mainnet operator configuration, two RPC providers and indexer.</li><li>Complete owner-operated agreement funding with a distinct provider wallet.</li></ul><p className="mt-5 text-sm text-slate-500">No deployment, RPC configuration, journal reset or signing action is available here. The existing factory must not be deployed again.</p></div></main>}
  <footer className="nv-footer">Built with Arc Studio <span>Studio preview · financial execution disabled</span></footer>
 </div>;
}
