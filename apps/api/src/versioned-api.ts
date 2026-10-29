import {associationMember} from './agreement-association.js';
import type {FastifyInstance,FastifyRequest,RouteOptions,HTTPMethods} from 'fastify';import type pg from 'pg';import {createHash} from 'node:crypto';
import type {ApiConfig} from './config.js';import {requireSession} from './routes/auth.js';import {ApiError,badRequest,forbidden,notFound} from './errors.js';
import {operationalSnapshotSql,evaluateOperationalSignals} from '../../../scripts/ops/signals.mjs';
type Params={wsId?:string;id?:string;chainId?:string;address?:string;grantId?:string};
type Meta={publicSnapshot?:boolean;attempt?:boolean;expectedHash?:string};const metadata=new WeakMap<FastifyRequest,Meta>();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function captureVersionedRoutes(app:FastifyInstance){
 const routes:RouteOptions[]=[];app.addHook('onRoute',route=>{routes.push(route as RouteOptions);});
 app.addHook('onSend',async(req,reply,payload)=>{
  if(!req.url.startsWith('/v1/')||req.url.split('?')[0]?.endsWith('/evidence')||typeof payload!=='string')return payload;
  let body:Record<string,unknown>;try{body=JSON.parse(payload);}catch{return payload;}
  const meta=metadata.get(req);if(meta?.publicSnapshot&&body.artifact){const a=body.artifact as Record<string,unknown>;body={identity:a.identity,terms:a.terms,accounting:a.accounting,provenance:a.provenance,status:a.status,source:a.source,verification:a.verification};reply.removeHeader('Content-Disposition');}
  if(meta?.attempt&&typeof body.id==='string')body={...body,intentId:body.id};
  if(meta?.expectedHash&&typeof body.hash==='string'&&body.hash.toLowerCase()!==meta.expectedHash.toLowerCase()){reply.code(409);body={error:{code:'CONFLICT',message:'Canonical transaction differs from the supplied hint. No replay authorized.'}};}
  reply.header('Cache-Control','no-store');
  if(reply.statusCode>=400){const error=body.error&&typeof body.error==='object'?body.error as Record<string,unknown>:{};return JSON.stringify({error:{code:typeof error.code==='string'?error.code:'REQUEST_BLOCKED',message:typeof error.message==='string'?error.message:'Request unavailable',retryable:false,details:{}},requestId:req.id});}
  return JSON.stringify({data:body,requestId:req.id,observedAt:new Date().toISOString()});
 });return routes;
}
export async function registerVersionedApi(app:FastifyInstance,pool:pg.Pool,cfg:ApiConfig,captured:RouteOptions[],configured:boolean){
 const routes=[...captured],s=cfg.db.schema;
 const find=(method:string,url:string)=>routes.find(r=>r.url===url&&(Array.isArray(r.method)?r.method:[r.method]).includes(method as HTTPMethods));
 type Adapt=(req:FastifyRequest)=>Promise<void>|void;
 function alias(method:HTTPMethods,url:string,sourceMethod:string,sourceUrl:string,adapt?:Adapt){
  const source=find(sourceMethod,sourceUrl);
  app.route({...(source??{}),method,url,handler:async(req,reply)=>{if(adapt)await adapt(req);if(!source)throw new ApiError(503,'CONFIGURATION_REQUIRED','Verified runtime prerequisites are unavailable.');return source.handler.call(app,req,reply);}} as RouteOptions);
 }
 async function resource(req:FastifyRequest,kind:'draft'|'attempt'){
  await requireSession(req,pool,s);const p=req.params as Params;if(!p.id||!uuid.test(p.id))throw badRequest('Invalid resource identity');
  const table=kind==='draft'?'terms_drafts':'transaction_attempts';const row=(await pool.query('SELECT workspace_id FROM '+s+'.'+table+' WHERE id=$1',[p.id])).rows[0];if(!row)throw notFound(kind,p.id);req.params={...p,wsId:row.workspace_id};
 }
 function body(req:FastifyRequest):Record<string,unknown>{if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw badRequest('JSON object required');return req.body as Record<string,unknown>;}
 function requestId(req:FastifyRequest){const key=req.headers['idempotency-key'];if(typeof key!=='string'||key.length<1||key.length>128)throw badRequest('Idempotency-Key required');const h=createHash('sha256').update(key).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20,32);}
 const reserved=new Set(['POST /workspaces/:wsId/drafts','GET /ready']);
 for(const route of routes){if(reserved.has(String(route.method)+' '+route.url)||route.url.startsWith('/v1/'))continue;for(const method of (Array.isArray(route.method)?route.method:[route.method]))if(method!=='HEAD')alias(method as HTTPMethods,'/v1'+route.url,method,route.url);}
 alias('POST','/v1/workspaces/:wsId/drafts','POST','/workspaces/:wsId/immutable-drafts');
 alias('POST','/v1/auth/session','POST','/auth/verify',async req=>{const b=body(req);if(Object.keys(b).sort().join()!=='challengeId,signature'||typeof b.challengeId!=='string'||!uuid.test(b.challengeId))throw badRequest('Exact challengeId and signature required');const r=(await pool.query('SELECT nonce,address,chain_id FROM '+s+'.wallet_challenges WHERE id=$1',[b.challengeId])).rows[0];if(!r)throw badRequest('Challenge unavailable');req.body={nonce:r.nonce,address:r.address,chainId:Number(r.chain_id),signature:b.signature};});
 alias('DELETE','/v1/auth/session','POST','/auth/logout');alias('GET','/v1/me','GET','/auth/me');alias('GET','/v1/health/live','GET','/health');
 alias('POST','/v1/drafts/:id/revisions','POST','/workspaces/:wsId/drafts/:id/revisions',req=>resource(req,'draft'));
 for(const method of ['GET','DELETE'] as const)alias(method,'/v1/drafts/:id',method,'/workspaces/:wsId/drafts/:id',req=>resource(req,'draft'));
 for(const [method,suffix] of [['POST','provider-grants'],['GET','acceptance-packet'],['DELETE','provider-grants/:grantId']] as const)alias(method,'/v1/revisions/:id/'+suffix,method,'/workspaces/:wsId/revisions/:id/'+suffix,req=>resource(req,'draft'));
 alias('POST','/v1/revisions/:id/acceptance','POST','/workspaces/:wsId/drafts/:id/provider-consent',req=>resource(req,'draft'));
 for(const [suffix,action] of [['prepare-create','create-agreement'],['prepare-approval','approve-creation']])alias('POST','/v1/revisions/:id/'+suffix,'POST','/workspaces/:wsId/attempts',async req=>{await resource(req,'draft');const p=req.params as Params;const b=req.body===undefined?{}:body(req);if(Object.keys(b).some(k=>k!=='expectedBinding'))throw badRequest('Only expectedBinding is accepted');req.body={resource:'draft:'+p.id,action,requestId:requestId(req),...b};metadata.set(req,{attempt:true});});
 alias('GET','/v1/agreements','GET','/workspaces/:wsId/indexed-agreements',req=>{const q=req.query as Record<string,unknown>;if(typeof q.workspaceId!=='string'||!uuid.test(q.workspaceId))throw badRequest('workspaceId required');req.params={wsId:q.workspaceId};});
 alias('GET','/v1/chain/:chainId/agreements/:address','GET','/v1/chain/:chainId/agreements/:address/evidence',req=>{metadata.set(req,{publicSnapshot:true});});
 const actions:Record<string,string>={APPROVE_RENEW:'approve-renewal',RENEW:'fund-renewal',START_NOTICE:'start-notice',MATERIALIZE_NOTICE:'materialize-notice',CLAIM_PROVIDER:'claim-provider',CLAIM_CLIENT_REFUND:'claim-client-refund'};
 alias('POST','/v1/chain/:chainId/agreements/:address/intents','POST','/workspaces/:wsId/attempts',async req=>{
  const me=await requireSession(req,pool,s),p=req.params as Params,b=body(req);if(p.chainId!==me.chainId.toString()||typeof p.address!=='string'||!/^0x[0-9a-f]{40}$/i.test(p.address)||typeof b.workspaceId!=='string'||!uuid.test(b.workspaceId)||typeof b.action!=='string'||!actions[b.action]||typeof b.expectedBinding!=='string'||! /^[0-9a-f]{64}$/.test(b.expectedBinding)||Object.keys(b).sort().join()!=='action,expectedBinding,workspaceId')throw badRequest('Exact chain, workspace, action and reviewed expectedBinding required');
  req.params={...p,wsId:b.workspaceId};req.body={resource:'agreement:'+p.address.toLowerCase(),action:actions[b.action],requestId:requestId(req),expectedBinding:b.expectedBinding};metadata.set(req,{attempt:true});
 });
 for(const [method,suffix,sourceSuffix] of [['POST','/reconcile','/reconcile'],['POST','/claim','/claim'],['POST','/cancel','/cancel'],['POST','/attempts','/reconcile']] as const)alias(method,'/v1/intents/:id'+suffix,method,'/workspaces/:wsId/attempts/:id'+sourceSuffix,async req=>{
  await resource(req,'attempt');const meta:Meta={attempt:true};if(suffix==='/attempts'){const b=body(req);if(Object.keys(b).sort().join()!=='transactionHash'||typeof b.transactionHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(b.transactionHash))throw badRequest('Exact transactionHash hint required; client receipts/status are not accepted');meta.expectedHash=b.transactionHash;req.body={};}metadata.set(req,meta);
 });
 app.get<{Params:{id:string}}>('/v1/intents/:id',async(req,reply)=>{
  const me=await requireSession(req,pool,s);if(!uuid.test(req.params.id))throw badRequest('Invalid intent identity');const c=await pool.connect();try{await c.query('BEGIN');
  const row=(await c.query('SELECT id,workspace_id,chain_id,resource,action,state,tx_hash,revision,preparation FROM '+s+'.transaction_attempts WHERE id=$1',[req.params.id])).rows[0];if(!row)throw notFound('intent',req.params.id);
  const member=await associationMember(c,s,me.sessionId,row.workspace_id,false);if(String(member.chain_id)!==row.chain_id)throw forbidden('Intent chain differs from membership');
  const result={intentId:row.id,id:row.id,chainId:row.chain_id,resource:row.resource,action:row.action,state:row.state,hash:row.tx_hash,revision:row.revision,source:row.preparation.source,nextSafeStep:['unknown','submitted','reorged','conflicted'].includes(row.state)?'RECONCILE_WITHOUT_RESUBMISSION':row.state==='reserved'?'CREATOR_REVIEW_AND_EXPLICIT_CLAIM_REQUIRED':'READ_CANONICAL_OUTCOME'};
  await c.query('COMMIT');return reply.send(result);
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });
 app.get('/v1/health/ready',async(_req,reply)=>{try{const migration=(await pool.query('SELECT max(version) AS version FROM '+s+'.schema_migrations')).rows[0];const snapshot=(await pool.query(operationalSnapshotSql(s))).rows[0].snapshot;const ready=configured&&Number(migration.version)>=21&&Number(snapshot.observedStreams)>0&&snapshot.maxObservedLagSeconds!==null&&Number(snapshot.maxObservedLagSeconds)<=300;return reply.code(ready?200:503).send({status:ready?'READ_ONLY_READY':'NOT_READY',database:true,migrations:Number(migration.version)>=21,configuredRuntime:configured,executionEnabled:false});}catch{return reply.code(503).send({error:{code:'NOT_READY',message:'Database, migrations or configured canonical runtime unavailable'}});}});
 app.get('/v1/ops/status',async(req,reply)=>{
  const me=await requireSession(req,pool,s);const rows=(await pool.query("SELECT workspace_id FROM "+s+".workspace_memberships WHERE lower(member_address)=$1 AND chain_id=$2 AND role='owner' ORDER BY workspace_id LIMIT 101",[me.memberAddress.toLowerCase(),me.chainId.toString()])).rows;
  if(!rows.length)throw forbidden('Current workspace owner required');if(rows.length>100)throw badRequest('Operational scope exceeds bounded owner workspaces');const ids=rows.map(r=>r.workspace_id as string);
  const snapshot=(await pool.query(operationalSnapshotSql(s,ids))).rows[0].snapshot;await requireSession(req,pool,s);
  const current=(await pool.query("SELECT workspace_id FROM "+s+".workspace_memberships WHERE lower(member_address)=$1 AND chain_id=$2 AND role='owner' AND workspace_id=ANY($3::uuid[]) ORDER BY workspace_id",[me.memberAddress.toLowerCase(),me.chainId.toString(),ids])).rows.map(r=>r.workspace_id as string);if(JSON.stringify(current)!==JSON.stringify(ids))throw forbidden('Operational membership changed');
  return reply.send(evaluateOperationalSignals(snapshot));
 });
}
