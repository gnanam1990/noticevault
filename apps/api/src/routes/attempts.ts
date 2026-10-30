import {canonicalAttemptResource,isStructuredAttemptResource} from '@noticevault/sdk';
import {assertClaimFreshness} from '../attempt-freshness.js';
import {isOperatorApprovalAdapter} from '../operator-approval.js';
import {isConfiguredAdapter} from '../configured-runtime.js';
import {reconcileAttempt,transitionAttempt} from '../attempt-reconciliation.js';
import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import type {ApiConfig} from '../config.js';
import {requireSession} from './auth.js';
import {associationMember} from '../agreement-association.js';
import {ApiError,badRequest,conflict,forbidden,notFound,unauthorized} from '../errors.js';
import {preparationBinding,validatePreparation} from '../attempt-evidence.js';
import type {AttemptInput,AttemptPreparation,SyntheticAttemptAdapter} from '../attempt-evidence.js';
type Row={id:string;workspace_id:string;actor:string;chain_id:string;resource:string;action:string;binding:string;preparation:AttemptPreparation;state:string;tx_hash:string|null;proof:unknown;revision:number;discovery?:unknown};
type Result={status:number;body:unknown};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions=['approve-creation','create-agreement','approve-renewal','fund-renewal','start-notice','materialize-notice','claim-provider','claim-client-refund'];
// Persisted preparation bytes define the binding and must remain unchanged.
function legacyIdentity(r:Row){return r.resource!==canonicalAttemptResource(r.resource)||r.preparation.resource!==r.resource||r.preparation.workspaceId!==r.workspace_id;}
function view(r:Row){return {source:r.preparation.source,id:r.id,workspaceId:r.workspace_id,account:r.actor,chainId:r.chain_id,resource:r.resource,action:r.action,binding:r.binding,state:r.state,hash:r.tx_hash,revision:r.revision,preparation:r.preparation,proof:r.proof,discovery:r.discovery??null};}
function empty(body:unknown){if(body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw badRequest('Client status, payload or receipt is not accepted');}
export async function attemptRoutes(app:FastifyInstance,pool:pg.Pool,cfg:ApiConfig,adapter?:SyntheticAttemptAdapter){
 const s=cfg.db.schema;if(!/^[a-z][a-z0-9_]*$/.test(s))throw new Error('Invalid schema');
 if(adapter&&!isConfiguredAdapter(adapter)&&!isOperatorApprovalAdapter(adapter)&&(adapter.source!=='SYNTHETIC'||Reflect.get(process.env,'NODE_ENV')!=='test'||cfg.configIdentity!=='LOCAL_FIXTURE'))throw new Error('Synthetic attempts require isolated construction');
 async function access(sessionId:string,ws:string,write:boolean,fn:(c:pg.PoolClient,input:{actor:string;chainId:string})=>Promise<Result>){
  if(!uuid.test(ws))throw badRequest('Invalid workspace');if(!adapter)throw new ApiError(503,'BLOCKED_EXECUTION','Verified production attempt provider unavailable');
  const c=await pool.connect();try{await c.query('BEGIN');const me=await associationMember(c,s,sessionId,ws,write),identity={actor:me.member_address.toLowerCase(),chainId:String(me.chain_id)};const result=await fn(c,identity);
   const final=await c.query('SELECT 1 FROM '+s+'.sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[sessionId]);if(!final.rows.length||new Date(me.expires_at).getTime()<=Date.now())throw unauthorized('Session expired');await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');if(e&&typeof e==='object'&&'code' in e&&e.code==='23505')throw conflict('Execution nonce or request already reserved');throw e;}finally{c.release();}
 }
 async function lock(c:pg.PoolClient,p:AttemptInput){await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['attempt:'+p.chainId+':'+p.actor.toLowerCase()+':'+canonicalAttemptResource(p.resource)]);}
 async function owned(c:pg.PoolClient,ws:string,id:string,who:{actor:string;chainId:string}){if(!uuid.test(id))throw badRequest('Invalid attempt ID');const r=(await c.query<Row>('SELECT * FROM '+s+'.transaction_attempts WHERE id=$1 AND workspace_id=$2',[id,ws])).rows[0];if(!r)throw notFound('attempt',id);if(r.actor!==who.actor||r.chain_id!==who.chainId)throw forbidden('Attempt belongs to another account or chain');return r;}
 const transition=(c:pg.PoolClient,r:Row,state:string,hash?:string,proof:unknown=null)=>transitionAttempt(c,s,r,state,hash,proof);
 const reconcile=(c:pg.PoolClient,r:Row)=>reconcileAttempt(c,s,r,adapter!);
 const base='/workspaces/:wsId/attempts';type Params={wsId:string;id:string};
 app.post<{Params:Params;Body:{resource:string;action:string;requestId:string;expectedBinding?:string}}>(base,async(req,reply)=>{const session=await requireSession(req,pool,s),ws=req.params.wsId.toLowerCase(),b=req.body;if(isConfiguredAdapter(adapter))throw new ApiError(503,'EXECUTION_DISABLED','Read-only runtime cannot reserve execution');
 if(!b||Object.keys(b).filter(k=>k!=='expectedBinding').sort().join(',')!=='action,requestId,resource'||(b.expectedBinding!==undefined&&(typeof b.expectedBinding!=='string'||! /^[0-9a-f]{64}$/.test(b.expectedBinding)))||typeof b.resource!=='string'||!/^[-a-zA-Z0-9:.]{1,200}$/.test(b.resource)||!actions.includes(b.action)||!uuid.test(b.requestId))throw badRequest('Exact resource, action and requestId required');
 const resource=canonicalAttemptResource(b.resource),requestId=b.requestId.toLowerCase();
 const result=await access(session.sessionId,ws,true,async(c,who)=>{
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['request:'+who.actor+':'+who.chainId+':'+ws+':'+requestId]);
  const prior=(await c.query<Row>('SELECT * FROM '+s+'.transaction_attempts WHERE actor=$1 AND chain_id=$2 AND workspace_id=$3 AND request_id=$4',[who.actor,who.chainId,ws,requestId])).rows[0];if(prior){if(legacyIdentity(prior)&&prior.state!=='cancelled')throw conflict('Stored attempt identity requires review');if(b.expectedBinding!==undefined&&prior.binding!==b.expectedBinding)throw conflict('Reviewed snapshot changed');if(prior.resource!==resource||prior.action!==b.action)throw conflict('Request ID belongs to another action');return {status:200,body:view(prior)};}
  const input={...who,workspaceId:ws,resource:resource,action:b.action};let p:AttemptPreparation;try{p=structuredClone(await adapter!.prepare(input));validatePreparation(p,input);if(b.expectedBinding!==undefined&&preparationBinding(p)!==b.expectedBinding)throw conflict('Reviewed snapshot changed');}catch{throw conflict('Trusted preparation unavailable or stale');}
  await lock(c,input);const rows=(await c.query<Row>('SELECT * FROM '+s+'.transaction_attempts WHERE actor=$1 AND chain_id=$2 AND (resource=$3 OR ($4::boolean AND lower(resource)=$3)) ORDER BY created_at FOR UPDATE',[who.actor,who.chainId,resource,isStructuredAttemptResource(resource)])).rows;
  for(const old of rows){if(old.state==='cancelled')continue;if(legacyIdentity(old))throw conflict('Stored attempt identity requires review');if(!['confirmed','reverted'].includes(old.state))throw conflict('Existing attempt requires reconciliation');const current=await reconcile(c,old);if(!['confirmed','reverted'].includes(current.state))return {status:409,body:{error:{code:'ATTEMPT_RELOCKED',message:'Canonical resolution changed; attempt remains locked'}}};if(current.action===b.action&&current.state==='confirmed'&&current.preparation.cycleKey===p.cycleKey)throw conflict('Confirmed cycle has not advanced');if(current.preparation.policyHash!==p.policyHash)throw conflict('Deployment policy changed');}
  const id=randomUUID(),binding=preparationBinding(p);const r=(await c.query<Row>('INSERT INTO '+s+'.transaction_attempts(id,workspace_id,actor,chain_id,resource,action,request_id,binding,network_nonce,preparation,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,\'reserved\') RETURNING *',[id,ws,who.actor,who.chainId,resource,b.action,requestId,binding,p.networkNonce,JSON.stringify(p)])).rows[0]!;
  await c.query('INSERT INTO '+s+'.transaction_attempt_events(attempt_id,to_state,revision) VALUES($1,\'reserved\',0)',[id]);return {status:201,body:view(r)};
 });return reply.code(result.status).header('Cache-Control','no-store').send(result.body);});
 app.get<{Params:Params}>(base+'/:id',async(req,reply)=>{const session=await requireSession(req,pool,s);const r=await access(session.sessionId,req.params.wsId,false,async(c,who)=>({status:200,body:view(await owned(c,req.params.wsId,req.params.id,who))}));return reply.header('Cache-Control','no-store').send(r.body);});
 for(const operation of ['claim','reconcile','cancel'] as const)app.post<{Params:Params}>(base+'/:id/'+operation,async(req,reply)=>{const session=await requireSession(req,pool,s);empty(req.body);if(isConfiguredAdapter(adapter)&&operation!=='reconcile')throw new ApiError(503,'EXECUTION_DISABLED','Read-only runtime cannot claim or cancel execution');const ws=req.params.wsId.toLowerCase();const result=await access(session.sessionId,ws,true,async(c,who)=>{
  let r=await owned(c,ws,req.params.id,who);await lock(c,{...who,workspaceId:ws,resource:r.resource,action:r.action});r=(await c.query<Row>('SELECT * FROM '+s+'.transaction_attempts WHERE id=$1 FOR UPDATE',[r.id])).rows[0]!;
  if(operation==='reconcile')return {status:200,body:view(await reconcile(c,r))};
  if(r.state!=='reserved')throw conflict('Attempt cannot be claimed or cancelled after handoff');
  if(operation==='cancel')return {status:200,body:view(await transition(c,r,'cancelled'))};
  if(legacyIdentity(r))throw conflict('Stored attempt identity requires review');
  let p:AttemptPreparation;try{const input={workspaceId:ws,...who,resource:r.resource,action:r.action};p=structuredClone(await adapter!.prepare(input));validatePreparation(p,input);}catch{throw conflict('Current trusted preparation unavailable');}
  try{await assertClaimFreshness(adapter!,r.preparation,p);}catch{throw conflict('Prepared payload or context changed or expired');}const next=await transition(c,r,'unknown');return {status:200,body:{...view(next),claimed:true}};
 });return reply.code(result.status).header('Cache-Control','no-store').send(result.body);});
}
