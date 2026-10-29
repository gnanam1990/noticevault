import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import type {ApiConfig} from '../config.js';
import {requireSession} from './auth.js';
import {ApiError,badRequest,conflict,forbidden,notFound,unauthorized} from '../errors.js';
import {ASSOCIATION_AUDIENCE,associationTarget,associationMember,canonicalCreation} from '../agreement-association.js';
type Params={wsId:string};
type Target=ReturnType<typeof associationTarget>;
export async function associationRoutes(app:FastifyInstance,pool:pg.Pool,cfg:ApiConfig){
 const s=cfg.db.schema;
 async function transaction<T>(sessionId:string,t:Target,write:boolean,fn:(c:pg.PoolClient,me:Awaited<ReturnType<typeof associationMember>>)=>Promise<T>){
  const c=await pool.connect();try{await c.query('BEGIN');const me=await associationMember(c,s,sessionId,t.workspace,write);const value=await fn(c,me);if(new Date(me.expires_at).getTime()<=Date.now())throw unauthorized('Session expired during request');await c.query('COMMIT');return value;}catch(e){try{await c.query('ROLLBACK');}catch{/* original error */}throw e;}finally{c.release();}
 }
 app.get<{Params:Params;Querystring:{streamId:string;agreement:string}}>('/workspaces/:wsId/association-candidate',async(req,reply)=>{
  const session=await requireSession(req,pool,s);const t=associationTarget(req.params.wsId,req.query.streamId,req.query.agreement);
  const proof=await transaction(session.sessionId,t,false,async(c,me)=>{const proof=await canonicalCreation(c,s,t.stream,t.agreement);if(new Date(me.expires_at).getTime()<=Date.now())throw unauthorized('Session expired while awaiting canonical state');if(String(me.chain_id)!==proof.chainId||![proof.client,proof.provider].includes(me.member_address.toLowerCase()))throw forbidden('Authenticated agreement participant required');return proof;});
  return reply.header('Cache-Control','no-store').send(proof);
 });
 app.post<{Params:Params;Body:{streamId:string;agreement:string;expectedFingerprint:string;audience:string;confirmed:boolean}}>('/workspaces/:wsId/indexed-associations',async(req,reply)=>{
  const session=await requireSession(req,pool,s);const b=req.body??{};const t=associationTarget(req.params.wsId,b.streamId,b.agreement);
  const result=await transaction(session.sessionId,t,true,async(c,me)=>{
   const proof=await canonicalCreation(c,s,t.stream,t.agreement);if(new Date(me.expires_at).getTime()<=Date.now())throw unauthorized('Session expired while awaiting canonical state');
   if(String(me.chain_id)!==proof.chainId||![proof.client,proof.provider].includes(me.member_address.toLowerCase()))throw forbidden('Authenticated agreement participant required');
   if(b.confirmed!==true||b.audience!==ASSOCIATION_AUDIENCE)throw badRequest('Explicit workspace audience confirmation required');
   if(b.expectedFingerprint!==proof.fingerprint)throw conflict('Creation or deployment policy changed; review again');
   const inserted=await c.query('INSERT INTO '+s+'.workspace_agreement_associations(workspace_id,stream_id,agreement,fingerprint,proof,associated_by,associated_chain,audience) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING fingerprint',[t.workspace,t.stream,t.agreement,proof.fingerprint,JSON.stringify(proof),me.member_address.toLowerCase(),String(me.chain_id),ASSOCIATION_AUDIENCE]);
   const existing=await c.query('SELECT fingerprint,associated_by,created_at FROM '+s+'.workspace_agreement_associations WHERE workspace_id=$1 AND stream_id=$2 AND agreement=$3',[t.workspace,t.stream,t.agreement]);
   if(existing.rows[0]?.fingerprint!==proof.fingerprint)throw conflict('Existing association cannot be rebound to a replacement creation');
   return {created:inserted.rows.length===1,body:{workspaceId:t.workspace,...proof,audience:ASSOCIATION_AUDIENCE,associatedBy:existing.rows[0].associated_by,createdAt:existing.rows[0].created_at,status:'CANONICAL'}};
  });return reply.header('Cache-Control','no-store').status(result.created?201:200).send(result.body);
 });
 app.get<{Params:Params&{streamId:string;agreement:string}}>('/workspaces/:wsId/indexed-associations/:streamId/:agreement',async(req,reply)=>{
  const session=await requireSession(req,pool,s);const t=associationTarget(req.params.wsId,req.params.streamId,req.params.agreement);
  const result=await transaction(session.sessionId,t,true,async(c,me)=>{
   const r=await c.query('SELECT * FROM '+s+'.workspace_agreement_associations WHERE workspace_id=$1 AND stream_id=$2 AND agreement=$3',[t.workspace,t.stream,t.agreement]);if(!r.rows.length)throw notFound('workspace agreement association',t.agreement);const a=r.rows[0];if(String(me.chain_id)!==a.associated_chain)throw forbidden('Session chain does not match association');
   let current:Awaited<ReturnType<typeof canonicalCreation>>|null=null;
   try{current=await canonicalCreation(c,s,t.stream,t.agreement);}catch(e){if(!(e instanceof ApiError)||![404,409].includes(e.statusCode))throw e;}
   const valid=current?.fingerprint===a.fingerprint;
   return {workspaceId:t.workspace,...a.proof,audience:a.audience,associatedBy:a.associated_by,createdAt:a.created_at,status:valid?'CANONICAL':'UNAVAILABLE',reason:valid?null:'CREATION_OR_POLICY_CHANGED',indexedHead:current?.indexedHead??null,indexedHeadHash:current?.indexedHeadHash??null,liveFreshness:'UNKNOWN'};
  });return reply.header('Cache-Control','no-store').send(result);
 });
}
