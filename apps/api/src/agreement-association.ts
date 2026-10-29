import {createHash} from 'node:crypto';
import type pg from 'pg';
import {badRequest,conflict,forbidden,notFound,unauthorized} from './errors.js';
import {findValidSession} from '@noticevault/db';
import {normalizeDeploymentPolicy} from './indexed-policy.js';
export const ASSOCIATION_AUDIENCE='current-and-future-workspace-members';
function canonical(v:unknown):string {if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v!==null&&typeof v==='object')return '{'+Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+':'+canonical(x)).join(',')+'}';return JSON.stringify(v);}
const digest=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
export function associationTarget(workspace:unknown,stream:unknown,agreement:unknown){
 if(typeof workspace!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspace)||typeof stream!=='string'||!stream.length||stream.length>128||typeof agreement!=='string'||!/^0x[0-9a-f]{40}$/i.test(agreement))throw badRequest('Invalid association target');
 return {workspace:workspace.toLowerCase(),stream,agreement:agreement.toLowerCase()};
}
export async function associationMember(c:pg.PoolClient,s:string,sessionId:string,workspace:string,write=false){
 const me=await findValidSession(c,s,sessionId);if(!me)throw unauthorized('Session expired or revoked');
 const locked=await c.query('SELECT id FROM '+s+'.sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE',[sessionId]);if(!locked.rows.length)throw unauthorized('Session expired or revoked');
 const member=await c.query('SELECT member_address,role FROM '+s+'.workspace_memberships WHERE workspace_id=$1 AND lower(member_address)=lower($2) AND chain_id=$3 FOR SHARE',[workspace,me.member_address,me.chain_id]);
 if(!member.rows.length)throw forbidden('Current workspace membership is required');if(write&&member.rows[0].role==='viewer')throw forbidden('Workspace editor required');return me;
}
/** Caller holds the stream row lock; no live RPC or caller-provided participant claim. */
export async function canonicalCreation(c:pg.PoolClient,s:string,stream:string,agreement:string){
 const streams=await c.query('SELECT * FROM '+s+'.indexer_streams WHERE stream_id=$1 FOR SHARE',[stream]);
 if(streams.rows.length!==1)throw notFound('indexed stream',stream);
 const state=streams.rows[0];let policy:ReturnType<typeof normalizeDeploymentPolicy>;
 try{policy=normalizeDeploymentPolicy(state.deployment_policy);}catch{throw conflict('Stream deployment policy is missing or invalid');}
 if(!['SYNTHETIC','RPC_OBSERVED'].includes(state.source)||state.source!==policy.mode||(state.source==='RPC_OBSERVED'&&!/^[0-9a-f]{64}$/.test(state.observation_policy??'')))throw conflict('Unsupported indexer source');
 const rows=await c.query("SELECT a.created_block,a.terms,b.block_hash,e.transaction_hash,e.log_index,e.payload FROM "+s+".indexed_agreements a JOIN "+s+".indexer_blocks b ON b.stream_id=a.stream_id AND b.block_number=a.created_block JOIN "+s+".indexer_events e ON e.stream_id=a.stream_id AND e.block_number=a.created_block WHERE a.stream_id=$1 AND a.agreement=$2 AND e.payload->>'eventName'='AgreementCreated' AND e.payload->'args'->>'agreement'=$2",[stream,agreement]);
 if(rows.rows.length!==1)throw notFound('canonical agreement creation',agreement);
 const r=rows.rows[0];if(canonical(r.terms)!==canonical(r.payload.args)||r.payload.address!==policy.factory)throw conflict('Creation projection/provenance mismatch');
 const proof={streamId:stream,agreement,source:policy.mode,...(policy.mode==='RPC_OBSERVED'?{observationPolicy:String(state.observation_policy)}:{}),chainId:policy.chainId,factory:policy.factory,token:policy.token,policyHash:digest(policy),bindingHash:String(state.binding_hash),creationBlock:String(r.created_block),creationBlockHash:String(r.block_hash),transactionHash:String(r.transaction_hash),logIndex:String(r.log_index),client:String(r.terms.client),provider:String(r.terms.provider),termsHash:digest(r.terms)};
 return {...proof,fingerprint:digest(proof),indexedHead:String(state.head_number),indexedHeadHash:String(state.head_hash),liveFreshness:'UNKNOWN' as const};
}
