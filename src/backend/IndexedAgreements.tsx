import {EvidenceDownloads} from './EvidenceDownloads';
import {OperatorSettlement} from './OperatorSettlement';
import {OperatorRenewal} from './OperatorRenewal';
import {AgreementSettlementReview} from './AgreementSettlementReview.js';
import {AgreementRenewalReview} from './AgreementRenewalReview.js';
import {useEffect,useMemo,useState} from 'react';
import {IndexedClient,LatestIndexedRead,type IndexedPage,type IndexedDetail,type IndexedEntry} from './indexed-client.js';
import {ReviewError} from './draft-review.js';
const api=new IndexedClient();
export default function IndexedAgreements({workspaceId,chainId,onExpired}:{workspaceId:string;chainId:string;onExpired:()=>void}){
 const requests=useMemo(()=>new LatestIndexedRead(),[]),[page,setPage]=useState<IndexedPage|null>(null),[detail,setDetail]=useState<IndexedDetail|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[cursors,setCursors]=useState<(string|null)[]>([null]);
 useEffect(()=>()=>requests.cancel(),[requests]);
 const failure=(e:unknown)=>{setBusy(false);setDetail(null);if(e instanceof ReviewError&&e.status===401){onExpired();return;}setError(e instanceof ReviewError?e.message:'Unable to load indexed records. Try again.');};
 function load(next:(string|null)[]){setBusy(true);setError('');setPage(null);setDetail(null);void requests.run(s=>api.list(workspaceId,chainId,next[next.length-1],s),v=>{setPage(v);setCursors(next);setBusy(false);},failure);}
 function inspect(a:IndexedEntry){setBusy(true);setError('');setDetail(null);void requests.run(s=>api.detail(workspaceId,chainId,a.streamId,a.agreement,s),v=>{setDetail(v);setBusy(false);},failure);}
 const f=detail?.financial,p=detail?.provenance;
 return <section aria-labelledby="indexed-heading" className="rounded-xl border border-slate-200 p-4 space-y-3">
 <h2 id="indexed-heading" className="font-semibold">Workspace indexed agreements</h2>
 <p className="text-sm">Synthetic indexed records shared explicitly with this workspace. Freshness relative to a live chain is unknown. These cumulative figures are not live balances or amounts available to spend. No live transaction actions are available here.</p>
 <button type="button" disabled={busy||!workspaceId} onClick={()=>load([null])} className="rounded border px-3 py-2">{page?'Refresh from first page':'Load agreements'}</button>
 {busy&&<p role="status">Loading current indexed projection…</p>}{error&&<p role="alert">{error}</p>}
 {page&&<><p className="text-sm">Page {cursors.length} · chain {page.chainId} · at most 20 records per page. Pagination is not a frozen snapshot; refresh after index changes.</p>
 {page.items.length===0?<p>No associated agreements on this chain.</p>:<ul className="space-y-2">{page.items.map(a=><li key={a.streamId+':'+a.agreement} className="border rounded p-2 break-all"><span>{a.streamId} / {a.agreement}</span>{a.status==='UNAVAILABLE'?<p>Unavailable: creation or deployment policy no longer matches. Financial and participant details are withheld.</p>:<><p>Indexed block {a.indexedHead}</p><button type="button" disabled={busy} onClick={()=>inspect(a)} className="rounded border px-3 py-2">View indexed detail</button></>}</li>)}</ul>}
 <div className="flex gap-2"><button type="button" disabled={busy||cursors.length===1} onClick={()=>load(cursors.slice(0,-1))}>Previous page</button><button type="button" disabled={busy||!page.nextCursor} onClick={()=>load([...cursors,page.nextCursor])}>Next page</button></div></>}
 {detail?.status==='UNAVAILABLE'&&<p role="status">This association became unavailable. No financial detail is displayed. Refresh the list.</p>}
 {f&&p&&<div className="space-y-3 break-all"><h3 className="font-semibold">Indexed detail: {detail?.agreement}</h3><p>Exact raw token base units; times are Unix seconds. Values reflect recorded events only.</p>
 <dl className="grid gap-2 sm:grid-cols-2">{Object.entries({'Amount per payment period':f.amountPerPeriod,'Payment period (seconds)':f.periodSeconds,'Notice duration (seconds)':f.noticeSeconds,'Agreement start (Unix seconds)':f.startAt,'Initial total funding':f.initialFunded,'Initial notice reserve':f.noticeReserve,'Cumulative regular funding':f.regularFunded,'Funded through (Unix seconds)':f.fundedThrough,'Cumulative regular earnings claimed':f.regularPaid,'Cumulative notice earnings claimed':f.noticePaid,'Cumulative client refunds':f.clientRefunded,'Last claim event (Unix seconds)':f.lastClaimObservedAt??'No recorded claim'}).map(([k,v])=><div key={k}><dt className="text-sm font-medium">{k}</dt><dd className="font-mono text-sm">{v}</dd></div>)}</dl>
 <p>{f.notice?'Recorded notice: '+(f.notice.reason==='1'?'Client cancellation':'Payment default')+'; start '+f.notice.start+'; end '+f.notice.end:'No recorded notice event.'}</p>
 <h4 className="font-medium">Canonical provenance</h4><dl className="text-sm space-y-1">{Object.entries(p).map(([k,v])=><div key={k}><dt>{k}</dt><dd className="font-mono">{v??'Unknown'}</dd></div>)}</dl><p className="text-sm">Reorganizations can change or remove these projections. Refresh to read the latest stored canonical state; no live freshness guarantee is provided.</p></div>}
 {f&&p&&detail&&<OperatorSettlement key={'operator-settlement:'+workspaceId+chainId+detail.agreement} workspaceId={workspaceId} streamId={detail.streamId} agreement={detail.agreement}/>}
  {f&&p&&detail&&<OperatorRenewal key={'operator:'+workspaceId+chainId+detail.agreement} workspaceId={workspaceId} streamId={detail.streamId} agreement={detail.agreement}/>}
  {f&&p&&detail&&<AgreementRenewalReview key={workspaceId+chainId+detail.agreement} agreement={detail.agreement} chainId={chainId}/>}
 {f&&p&&detail&&<AgreementSettlementReview key={"settlement:"+workspaceId+chainId+detail.agreement} agreement={detail.agreement} chainId={chainId}/>}
 {p&&detail&&<EvidenceDownloads key={workspaceId+chainId+detail.agreement} workspaceId={workspaceId} chainId={chainId} streamId={detail.streamId} agreement={detail.agreement} onExpired={onExpired}/> }
</section>;
}
