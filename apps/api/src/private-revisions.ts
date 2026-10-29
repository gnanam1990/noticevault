import type pg from 'pg';
import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {keccak256} from 'viem';
import {createDraft,getMembership} from '@noticevault/db';
import {buildTypedData,parseTerms} from '@noticevault/sdk';
import type {ApiConfig} from './config.js';
import {requireSession} from './routes/auth.js';
import {parseAndValidateTermsJson} from './routes/drafts.js';
import {associationMember} from './agreement-association.js';
import {mutateOnce} from './mutations.js';
import {badRequest,conflict,forbidden,notFound} from './errors.js';
import {stringify} from './reviewed-artifacts.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const valid=(...ids:string[])=>{if(ids.some(id=>!uuid.test(id)))throw badRequest('Invalid workspace or revision ID');};
export async function revisionAccess(c:pg.PoolClient,s:string,sid:string,ws:string,id:string,consent=false,deployment?:unknown){
 const me=(await c.query('SELECT * FROM '+s+'.sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[sid])).rows[0];if(!me)throw forbidden('Active authentication required');
 const r=(await c.query('SELECT r.*,d.terms_json FROM '+s+'.draft_revisions r JOIN '+s+'.terms_drafts d ON d.id=r.id WHERE r.id=$1 AND r.workspace_id=$2',[id,ws])).rows[0];
 if(!r){if(consent){await associationMember(c,s,sid,ws);return null;}throw notFound('immutable revision',id);}
 if(keccak256(r.document_bytes)!==r.document_hash||r.terms_json.termsDocumentHash.toLowerCase()!==r.document_hash||r.terms_json.provider.toLowerCase()!==r.provider_address)throw conflict('Private revision integrity mismatch');
 if(String(me.chain_id)!==String(r.chain_id))throw forbidden('Revision and authenticated chain differ');
 if(deployment&&!isDeepStrictEqual(r.deployment_json,JSON.parse(stringify(deployment))))throw conflict('Revision deployment differs from configured consent deployment');
 const lockedMembership=await c.query('SELECT id FROM '+s+'.workspace_memberships WHERE workspace_id=$1 AND lower(member_address)=lower($2) AND chain_id=$3 FOR SHARE',[ws,me.member_address,String(me.chain_id)]);const member=lockedMembership.rows.length?await getMembership(c,s,ws,me.member_address,BigInt(me.chain_id)):null;
 const provider=me.member_address.toLowerCase()===r.provider_address;
 if(consent&&!provider)throw forbidden('Only the exact revision provider may accept');
 if(!member){if(!provider)throw forbidden('Private revision access denied');const grant=await c.query('SELECT id FROM '+s+'.revision_provider_grants WHERE revision_id=$1 AND chain_id=$2 AND provider_address=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[id,r.chain_id,r.provider_address]);if(!grant.rows.length)throw forbidden('Active revision-specific provider grant required');}
 return {...r,accessRole:member?.role??'provider-grant'};
}
export async function privateRevisionRoutes(app:FastifyInstance,pool:pg.Pool,cfg:ApiConfig){
 const s=cfg.db.schema;
 const member=async(session:Awaited<ReturnType<typeof requireSession>>,ws:string)=>{const m=await getMembership(pool,s,ws,session.memberAddress,session.chainId);if(!m)throw forbidden('Workspace membership required');return m;};
 const saveRevision=async(req:FastifyRequest<{Params:{wsId:string;id?:string};Body:{termsJson:unknown;documentText:string;expectedRevisionNumber:number}}>,reply:FastifyReply)=>{
  const me=await requireSession(req,pool,s),{wsId,id}=req.params;valid(wsId,...(id?[id]:[]));const m=await member(me,wsId);if(!['owner','member','editor'].includes(m.role))throw forbidden('Editor required');
  const b=req.body;if(!b||typeof b.documentText!=='string'||!Number.isSafeInteger(b.expectedRevisionNumber)||b.expectedRevisionNumber<0)throw badRequest('Exact document text and expected revision number required');
  const bytes=Buffer.from(b.documentText,'utf8');if(!bytes.length||bytes.length>262144||bytes.toString('utf8')!==b.documentText)throw badRequest('Document must be valid UTF-8 text, 1–262144 bytes');
  const terms=await parseAndValidateTermsJson(b.termsJson),hash=keccak256(bytes);if(terms.termsDocumentHash.toLowerCase()!==hash)throw conflict('Document bytes do not match signed termsDocumentHash');
  const result=await mutateOnce(pool,s,me.memberAddress,me.chainId,req.headers['idempotency-key'],'POST /workspaces/'+wsId+(id?'/drafts/'+id+'/revisions':'/immutable-drafts'),{terms,documentText:b.documentText,expectedRevisionNumber:b.expectedRevisionNumber},async(c)=>{
   await associationMember(c,s,me.sessionId,wsId);const current=await getMembership(c,s,wsId,me.memberAddress,me.chainId);if(!current||!['owner','member','editor'].includes(current.role))throw forbidden('Current workspace editor required');
   const rid=randomUUID();let family=rid,head=0;if(id){
   const original=(await c.query('SELECT id FROM '+s+'.terms_drafts WHERE id=$1 AND workspace_id=$2',[id,wsId])).rows[0];if(!original)throw notFound('draft',id);
   family=(await c.query('SELECT family_id FROM '+s+'.draft_revisions WHERE id=$1',[id])).rows[0]?.family_id??id;
   await c.query('SELECT id FROM '+s+'.terms_drafts WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[family,wsId]);
   head=Number((await c.query('SELECT COALESCE(MAX(revision_number),0) AS n FROM '+s+'.draft_revisions WHERE family_id=$1',[family])).rows[0].n);}if(head!==b.expectedRevisionNumber)throw conflict('A newer revision exists; review it before saving');
   const draft=await createDraft(c,s,rid,wsId,me.memberAddress,terms,hash),dep=cfg.consentDeployment;
   if(dep&&dep.chainId!==me.chainId)throw forbidden('Session and revision deployment chain differ');
   const domain=dep?buildTypedData(parseTerms({...terms,schemaVersion:String(terms.schemaVersion)}),dep).domain:null;
   await c.query('INSERT INTO '+s+'.draft_revisions(id,family_id,workspace_id,revision_number,chain_id,provider_address,document_bytes,document_hash,deployment_json,domain_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)',[rid,family,wsId,head+1,me.chainId.toString(),terms.provider.toLowerCase(),bytes,hash,dep?stringify(dep):null,domain?stringify(domain):null]);
   return {status:201,body:{...draft,revisionNumber:head+1,familyId:family,immutable:true}};
  });return reply.header('Cache-Control','no-store').status(result.status).send(result.body);
 };
 app.post('/workspaces/:wsId/drafts/:id/revisions',saveRevision);
 app.post('/workspaces/:wsId/immutable-drafts',saveRevision);
 app.delete<{Params:{wsId:string;id:string}}>('/workspaces/:wsId/drafts/:id',async(req,reply)=>{
  const me=await requireSession(req,pool,s),{wsId,id}=req.params;if(!uuid.test(wsId)||!uuid.test(id))throw badRequest('Exact workspace/draft identity required');const c=await pool.connect();try{await c.query('BEGIN');await associationMember(c,s,me.sessionId,wsId,true);
  const draft=(await c.query('SELECT status FROM '+s+'.terms_drafts WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[id,wsId])).rows[0];if(!draft)throw notFound('draft',id);
  const retained=(await c.query('SELECT EXISTS(SELECT 1 FROM '+s+'.accepted_consents WHERE draft_id=$1) OR EXISTS(SELECT 1 FROM '+s+'.revision_provider_grants WHERE revision_id=$1) OR EXISTS(SELECT 1 FROM '+s+'.draft_revisions WHERE (family_id=$1 AND id<>$1) OR (id=$1 AND family_id<>$1)) OR EXISTS(SELECT 1 FROM '+s+'.transaction_attempts WHERE workspace_id=$2 AND resource=$3) OR EXISTS(SELECT 1 FROM '+s+'.intents WHERE workspace_id=$2 AND position($1::text in result_json::text)>0) AS retained',[id,wsId,'draft:'+id])).rows[0].retained;
  if(draft.status!=='draft'||retained)throw conflict('Shared, signed, revised or execution-linked drafts must be retained; deletion never revokes financial acceptance');
  await c.query('DELETE FROM '+s+'.draft_revisions WHERE id=$1 AND family_id=$1',[id]);await c.query('DELETE FROM '+s+'.terms_drafts WHERE id=$1 AND workspace_id=$2',[id,wsId]);await c.query('COMMIT');return reply.send({deleted:true,financialEffect:'NONE'});
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });

 app.get<{Params:{wsId:string;id:string}}>('/workspaces/:wsId/drafts/:id/revisions',async(req,reply)=>{
  const me=await requireSession(req,pool,s),{wsId,id}=req.params;valid(wsId,id);await member(me,wsId);
  const rows=await pool.query('SELECT r.id,r.family_id,r.revision_number,r.document_hash,r.created_at FROM '+s+'.draft_revisions r WHERE r.workspace_id=$1 AND r.family_id=COALESCE((SELECT family_id FROM '+s+'.draft_revisions WHERE id=$2 AND workspace_id=$1),$2::uuid) ORDER BY r.revision_number',[wsId,id]);return reply.header('Cache-Control','no-store').send({items:rows.rows});
 });
 app.get<{Params:{wsId:string;id:string}}>('/workspaces/:wsId/revisions/:id/acceptance-packet',async(req,reply)=>{
  const me=await requireSession(req,pool,s),{wsId,id}=req.params;valid(wsId,id);const c=await pool.connect();try{await c.query('BEGIN');const r=await revisionAccess(c,s,me.sessionId,wsId,id);if(!r)throw notFound('revision',id);
   const hash=keccak256(r.document_bytes);if(hash!==r.document_hash||r.terms_json.termsDocumentHash.toLowerCase()!==hash||r.terms_json.provider.toLowerCase()!==r.provider_address)throw conflict('Private revision integrity mismatch');
   await c.query('COMMIT');return reply.header('Cache-Control','no-store').send({canManage:['owner','member','editor'].includes(r.accessRole),revisionId:r.id,revisionNumber:r.revision_number,chainId:String(r.chain_id),terms:r.terms_json,domain:r.domain_json,documentText:r.document_bytes.toString('utf8'),documentHash:hash,acceptanceDeadline:r.terms_json.acceptanceDeadline,consentAvailable:Boolean(r.domain_json),consentPath:'/workspaces/'+wsId+'/drafts/'+id+'/provider-consent'});
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });
}
export async function providerGrantRoutes(app:FastifyInstance,pool:pg.Pool,cfg:ApiConfig){
 const s=cfg.db.schema;
 app.get<{Params:{wsId:string;id:string}}>('/workspaces/:wsId/revisions/:id/provider-grants',async(req,reply)=>{
  const me=await requireSession(req,pool,s),{wsId,id}=req.params;valid(wsId,id);const m=await getMembership(pool,s,wsId,me.memberAddress,me.chainId);if(!m||!['owner','member','editor'].includes(m.role))throw forbidden('Workspace editor required');
  const r=await pool.query('SELECT g.id,g.provider_address,g.chain_id,g.expires_at,g.revoked_at FROM '+s+'.revision_provider_grants g JOIN '+s+'.draft_revisions r ON r.id=g.revision_id WHERE r.id=$1 AND r.workspace_id=$2 ORDER BY g.created_at',[id,wsId]);return reply.header('Cache-Control','no-store').send({items:r.rows});
 });
 app.post<{Params:{wsId:string;id:string};Body:{expiresAt?:string}}>('/workspaces/:wsId/revisions/:id/provider-grants',async(req,reply)=>{
  const me=await requireSession(req,pool,s),{wsId,id}=req.params;valid(wsId,id);const m=await getMembership(pool,s,wsId,me.memberAddress,me.chainId);if(!m||!['owner','member','editor'].includes(m.role))throw forbidden('Workspace editor required');
  if(req.body?.expiresAt!==undefined&&typeof req.body.expiresAt!=='string')throw badRequest('Grant expiry must be an ISO date string');
  if(req.body&&Object.keys(req.body).some(k=>k!=='expiresAt'))throw badRequest('Provider and chain are derived from the immutable revision');
  const result=await mutateOnce(pool,s,me.memberAddress,me.chainId,req.headers['idempotency-key'],'POST /workspaces/'+wsId+'/revisions/'+id+'/provider-grants',req.body??{},async(c)=>{
   await associationMember(c,s,me.sessionId,wsId);const current=await getMembership(c,s,wsId,me.memberAddress,me.chainId);if(!current||!['owner','member','editor'].includes(current.role))throw forbidden('Current workspace editor required');const r=await revisionAccess(c,s,me.sessionId,wsId,id);if(!r)throw notFound('revision',id);
   const deadline=Number(r.terms_json.acceptanceDeadline)*1000,expiry=req.body?.expiresAt===undefined?deadline:Date.parse(req.body.expiresAt);
   if(!Number.isFinite(expiry)||!Number.isFinite(new Date(expiry).getTime())||expiry>deadline)throw badRequest('Grant expiry must not exceed this revision acceptance deadline');
   const grant=await c.query('INSERT INTO '+s+'.revision_provider_grants(revision_id,chain_id,provider_address,expires_at) SELECT $1,$2,$3,$4 WHERE $4::timestamptz>clock_timestamp() RETURNING id,revision_id,chain_id,provider_address,expires_at',[id,r.chain_id,r.provider_address,new Date(expiry)]);if(!grant.rows[0])throw conflict('Revision or requested grant has expired');return {status:201,body:grant.rows[0]};
  });return reply.header('Cache-Control','no-store').status(result.status).send(result.body);
 });
 app.delete<{Params:{wsId:string;id:string;grantId:string}}>('/workspaces/:wsId/revisions/:id/provider-grants/:grantId',async(req,reply)=>{
  const me=await requireSession(req,pool,s),{wsId,id,grantId}=req.params;valid(wsId,id,grantId);const c=await pool.connect();try{await c.query('BEGIN');await associationMember(c,s,me.sessionId,wsId);const current=await getMembership(c,s,wsId,me.memberAddress,me.chainId);if(!current||!['owner','member','editor'].includes(current.role))throw forbidden('Current workspace editor required');const m=await getMembership(c,s,wsId,me.memberAddress,me.chainId);if(!m||!['owner','member','editor'].includes(m.role))throw forbidden('Workspace editor required');
   const r=await c.query('UPDATE '+s+'.revision_provider_grants g SET revoked_at=COALESCE(revoked_at,clock_timestamp()) FROM '+s+'.draft_revisions r WHERE g.id=$1 AND g.revision_id=$2 AND r.id=g.revision_id AND r.workspace_id=$3 RETURNING g.id',[grantId,id,wsId]);if(!r.rows[0])throw notFound('revision grant',grantId);await c.query('COMMIT');return reply.status(204).send();
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });
}
