import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import type {ApiConfig} from '../config.js';
import {requireSession} from './auth.js';
import {ApiError,badRequest,notFound,forbidden,unauthorized} from '../errors.js';
import {associationMember,associationTarget,canonicalCreation} from '../agreement-association.js';
type Params={wsId:string};
type Link={stream_id:string;agreement:string;fingerprint:string;associated_chain:string};
type Proof=Awaited<ReturnType<typeof canonicalCreation>>;
const unavailable=(ws:string,a:Link,reason='CREATION_OR_POLICY_CHANGED')=>({workspaceId:ws,streamId:a.stream_id,agreement:a.agreement,status:'UNAVAILABLE' as const,reason});
const summary=(ws:string,p:Proof)=>({workspaceId:ws,streamId:p.streamId,agreement:p.agreement,status:'CANONICAL' as const,source:p.source,liveFreshness:p.liveFreshness,indexedHead:p.indexedHead,indexedHeadHash:p.indexedHeadHash,policyHash:p.policyHash});
export async function indexedAgreementRoutes(app:FastifyInstance,pool:pg.Pool,cfg:ApiConfig){
 const s=cfg.db.schema;
 async function access<T>(sessionId:string,ws:string,fn:(c:pg.PoolClient,chain:string)=>Promise<T>){const c=await pool.connect();try{await c.query('BEGIN');const me=await associationMember(c,s,sessionId,ws);const value=await fn(c,String(me.chain_id));if(new Date(me.expires_at).getTime()<=Date.now())throw unauthorized('Session expired during request');await c.query('COMMIT');return value;}catch(e){try{await c.query('ROLLBACK');}catch{/* original error */}throw e;}finally{c.release();}}
 async function current(c:pg.PoolClient,a:Link):Promise<Proof|null>{try{const p=await canonicalCreation(c,s,a.stream_id,a.agreement);return p.fingerprint===a.fingerprint&&p.chainId===a.associated_chain?p:null;}catch(e){if(e instanceof ApiError&&[404,409].includes(e.statusCode))return null;throw e;}}
 app.get<{Params:Params;Querystring:{after?:string}}>('/workspaces/:wsId/indexed-agreements',async(req,reply)=>{
  const session=await requireSession(req,pool,s);const ws=associationTarget(req.params.wsId,'cursor','0x'+'0'.repeat(40)).workspace;
  const page=await access(session.sessionId,ws,async(c,chain)=>{
   let afterStream:string|null=null,afterAgreement:string|null=null;
   if(req.query.after!==undefined){try{const text=req.query.after;if(typeof text!=='string'||!/^[A-Za-z0-9_-]{1,1024}$/.test(text))throw new Error();const bytes=Buffer.from(text,'base64url');if(bytes.toString('base64url')!==text)throw new Error();const v=JSON.parse(bytes.toString('utf8'));if(Object.keys(v).length!==5||v.v!==1||v.workspaceId!==ws||v.chainId!==chain)throw new Error();const t=associationTarget(ws,v.streamId,v.agreement);afterStream=t.stream;afterAgreement=t.agreement;}catch{throw badRequest('Invalid cursor for this workspace and chain');}}
   const rows=await c.query<Link>('SELECT stream_id,agreement,fingerprint,associated_chain FROM '+s+'.workspace_agreement_associations WHERE workspace_id=$1 AND associated_chain=$2 AND ($3::text IS NULL OR (stream_id,agreement)>($3,$4)) ORDER BY stream_id,agreement LIMIT 21',[ws,chain,afterStream,afterAgreement]);
   const items=[];for(const a of rows.rows.slice(0,20)){const p=await current(c,a);items.push(p?summary(ws,p):unavailable(ws,a));}
   const last=rows.rows[19];const nextCursor=rows.rows.length>20&&last?Buffer.from(JSON.stringify({v:1,workspaceId:ws,chainId:chain,streamId:last.stream_id,agreement:last.agreement})).toString('base64url'):null;
   return {workspaceId:ws,chainId:chain,source:items.some(x=>'source' in x&&x.source==='RPC_OBSERVED')?(items.some(x=>'source' in x&&x.source==='SYNTHETIC')?'MIXED':'RPC_OBSERVED'):'SYNTHETIC',liveFreshness:'UNKNOWN',items,nextCursor};
  });return reply.header('Cache-Control','no-store').send(page);
 });
 app.get<{Params:Params&{streamId:string;agreement:string}}>('/workspaces/:wsId/indexed-agreements/:streamId/:agreement',async(req,reply)=>{
  const session=await requireSession(req,pool,s);const t=associationTarget(req.params.wsId,req.params.streamId,req.params.agreement);
  const detail=await access(session.sessionId,t.workspace,async(c,chain)=>{
   const links=await c.query<Link>('SELECT stream_id,agreement,fingerprint,associated_chain FROM '+s+'.workspace_agreement_associations WHERE workspace_id=$1 AND stream_id=$2 AND agreement=$3',[t.workspace,t.stream,t.agreement]);const a=links.rows[0];if(!a)throw notFound('workspace agreement association',t.agreement);if(a.associated_chain!==chain)throw forbidden('Session chain does not match association');const p=await current(c,a);if(!p)return unavailable(t.workspace,a);
   const rows=await c.query('SELECT a.terms,f.regular_funded,f.funded_through,c.regular_paid,c.notice_paid,c.last_observed_at,c.recipient AS provider_recipient,r.client_refunded,r.recipient AS client_recipient,n.notice_start,n.notice_end,n.reason FROM '+s+'.indexed_agreements a JOIN '+s+'.indexed_funding f USING(stream_id,agreement) JOIN '+s+'.indexed_claims c USING(stream_id,agreement) JOIN '+s+'.indexed_refunds r USING(stream_id,agreement) LEFT JOIN '+s+'.indexed_notice n USING(stream_id,agreement) WHERE a.stream_id=$1 AND a.agreement=$2',[t.stream,t.agreement]);const r=rows.rows[0];if(!r||r.provider_recipient!==p.provider||r.client_recipient!==p.client)return unavailable(t.workspace,a,'PROJECTION_INCOMPLETE');
   const values={amountPerPeriod:r.terms.amountPerPeriod,periodSeconds:r.terms.periodSeconds,noticeSeconds:r.terms.noticeSeconds,startAt:r.terms.startAt,noticeReserve:r.terms.noticeReserve,initialFunded:r.terms.initialFunded,regularFunded:r.regular_funded,fundedThrough:r.funded_through,regularPaid:r.regular_paid,noticePaid:r.notice_paid,clientRefunded:r.client_refunded};
   if(Object.values(values).some(v=>typeof v!=='string'||!/^(0|[1-9][0-9]*)$/.test(v)||BigInt(v)>=(1n<<256n)))return unavailable(t.workspace,a,'PROJECTION_INCOMPLETE');
   const notice=r.notice_start===null?null:{start:String(r.notice_start),end:String(r.notice_end),reason:String(r.reason)};
   if(notice&&(!['1','2'].includes(notice.reason)||!/^[0-9]+$/.test(notice.start)||!/^[0-9]+$/.test(notice.end)))return unavailable(t.workspace,a,'PROJECTION_INCOMPLETE');
   return {...summary(t.workspace,p),provenance:p,financial:{...values,lastClaimObservedAt:r.last_observed_at===null?null:String(r.last_observed_at),notice}};
  });return reply.header('Cache-Control','no-store').send(detail);
 });
}
