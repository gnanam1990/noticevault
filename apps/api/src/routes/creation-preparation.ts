import {isConfiguredAdapter} from '../configured-runtime.js';
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import type {ApiConfig} from '../config.js';
import {requireSession} from './auth.js';
import {associationMember} from '../agreement-association.js';
import {ApiError,badRequest,conflict,forbidden,notFound,unauthorized} from '../errors.js';
import {draftCreationBinding,prepareBoundDraftCreation,computeTermsDigest,validateTermsInput} from '@noticevault/sdk';
import type {DraftConsentSnapshot,MinimalPublicClient,NoticeVaultDeployment,TermsInput,WalletContext} from '@noticevault/sdk';
import {encodeFunctionData} from 'viem';
import type {Abi} from 'viem';
/** Injected only by isolated test construction. Never loaded from environment or HTTP. */
export interface SyntheticConsentAdapter {readonly source?:'SYNTHETIC'|'CONFIGURED_READ_ONLY';readonly deployment:NoticeVaultDeployment;readonly rpc:MinimalPublicClient;readonly readWallet:()=>Promise<WalletContext>;}
type Params={wsId:string;id:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash=/^0x[0-9a-f]{64}$/i;
function terms(raw:unknown):TermsInput {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw conflict('Invalid persisted terms');
 const t=raw as Record<string,unknown>;
 for(const k of ['amountPerPeriod','periodSeconds','noticeSeconds','startAt','clientNonce','acceptanceDeadline'])if(typeof t[k]!=='string'||! /^[0-9]+$/.test(t[k]))throw conflict('Invalid persisted exact amount');
 const result={...t,amountPerPeriod:BigInt(t.amountPerPeriod as string),periodSeconds:BigInt(t.periodSeconds as string),noticeSeconds:BigInt(t.noticeSeconds as string),startAt:BigInt(t.startAt as string),clientNonce:BigInt(t.clientNonce as string),acceptanceDeadline:BigInt(t.acceptanceDeadline as string)} as unknown as TermsInput;
 validateTermsInput(result);return result;
}
export async function creationPreparationRoutes(app:FastifyInstance,pool:pg.Pool,cfg:ApiConfig,adapter?:SyntheticConsentAdapter){
 const dep=adapter?Object.freeze({...adapter.deployment}):null;const s=cfg.db.schema;
 if(adapter&&!isConfiguredAdapter(adapter)&&(Reflect.get(process.env,'NODE_ENV')!=='test'||cfg.configIdentity!=='LOCAL_FIXTURE'||dep?.isLive!==false))throw new Error('Synthetic consent adapter requires isolated test construction');
 if(!/^[a-z][a-z0-9_]*$/.test(s))throw new Error('Invalid schema');
 const blocked=()=>new ApiError(503,'BLOCKED_SDK','Verified live deployment/provider prerequisites are unavailable.');
 async function handle(req:Parameters<typeof requireSession>[0]&{params:Params;body?:{binding?:string;account?:string;chainId?:string}},prepare:boolean){
 const initial=await requireSession(req,pool,s);const {wsId,id}=req.params;if(!uuid.test(wsId)||!uuid.test(id))throw badRequest('Invalid workspace/draft ID');
 if(!adapter||!dep)throw blocked();
 const a=adapter;const policy=dep;const c=await pool.connect();let inTx=false;let loads=0;let expiry=0;
 const loadCurrent=async():Promise<DraftConsentSnapshot>=>{
  if(!inTx){await c.query('BEGIN');inTx=true;}
  await associationMember(c,s,initial.sessionId,wsId,true);const me=(await c.query('SELECT member_address,chain_id,expires_at FROM '+s+'.sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[initial.sessionId])).rows[0];if(!me)throw unauthorized('Session expired or revoked');expiry=new Date(me.expires_at).getTime();
  if(me.member_address.toLowerCase()!==initial.memberAddress.toLowerCase()||String(me.chain_id)!==initial.chainId.toString()||initial.chainId!==policy.chainId)throw forbidden('Session identity or chain changed');
  const d=(await c.query('SELECT * FROM '+s+'.terms_drafts WHERE id=$1 AND workspace_id=$2 FOR SHARE',[id,wsId])).rows[0];if(!d)throw notFound('draft',id);
  const t=terms(d.terms_json);if(t.client.toLowerCase()!==me.member_address.toLowerCase())throw forbidden('Authenticated draft client required');
  const proof=(await c.query('SELECT * FROM '+s+'.accepted_consents WHERE draft_id=$1 AND workspace_id=$2 AND lower(signer_address)=lower($3) FOR SHARE',[id,wsId,t.provider])).rows[0];
  if(!proof||String(proof.chain_id)!==policy.chainId.toString()||proof.terms_digest.toLowerCase()!==computeTermsDigest(t,policy).toLowerCase())throw conflict('Current accepted consent is unavailable or mismatched');
  const snapshot={workspaceId:wsId,draftId:id,version:d.version,docHash:d.doc_hash,status:d.status,terms:t,signature:proof.signature_hex} as DraftConsentSnapshot;
  draftCreationBinding(snapshot,policy);
  if(++loads===1&&prepare){await c.query('COMMIT');inTx=false;}return snapshot;
 };
 try{
  if(!prepare){const d=await loadCurrent();if(expiry<=Date.now())throw unauthorized('Session expired');await c.query('COMMIT');inTx=false;return {source:a.source??'SYNTHETIC',binding:draftCreationBinding(d,policy),workspaceId:wsId,draftId:id,version:d.version,factory:policy.factoryAddress,account:initial.memberAddress,chainId:initial.chainId.toString()};}
  const b=req.body??{};if(typeof b.binding!=='string'||!hash.test(b.binding))throw badRequest('Expected binding required');
  if(typeof b.account!=='string'||b.account.toLowerCase()!==initial.memberAddress.toLowerCase()||b.chainId!==initial.chainId.toString())throw forbidden('Requested wallet context differs from session');
  const result=await prepareBoundDraftCreation(b.binding,{deployment:policy,rpc:a.rpc,readWallet:a.readWallet,loadCurrent});
  if(expiry<=Date.now())throw unauthorized('Session expired during preparation');
  const transaction={to:result.request.to,data:encodeFunctionData({abi:result.request.abi as Abi,functionName:result.request.functionName,args:result.request.args}),chainId:result.request.chainId.toString(),value:'0'};
  await c.query('COMMIT');inTx=false;return {source:a.source??'SYNTHETIC',binding:result.binding,workspaceId:wsId,draftId:id,blockNumber:result.blockNumber.toString(),blockHash:result.blockHash,observedAt:result.observedAt,transaction};
 }catch(e){if(inTx)await c.query('ROLLBACK');if(e instanceof ApiError)throw e;throw conflict('Draft, consent, wallet, policy or canonical evidence changed/unavailable');}finally{c.release();}
 }
 app.get<{Params:Params;Body:{binding?:string;account?:string;chainId?:string}}>('/workspaces/:wsId/drafts/:id/creation-context',async(req,reply)=>reply.header('Cache-Control','no-store').send(await handle(req,false)));
 app.post<{Params:Params;Body:{binding?:string;account?:string;chainId?:string}}>('/workspaces/:wsId/drafts/:id/creation-preparation',async(req,reply)=>reply.header('Cache-Control','no-store').send(await handle(req,true)));
}
