import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import {keccak256,toHex,type Hex} from 'viem';
import {buildTypedData,computeTermsDigest,parseTerms,serializeTerms,observeFactoryForCreation,issueProviderConsent,type SerializedTerms} from '@noticevault/sdk';
import {createAcceptedConsent} from '@noticevault/db';
import type {ApiConfig} from './config.js';
import type {ConfiguredRuntime} from './configured-runtime.js';
import type {SyntheticAttemptAdapter} from './attempt-evidence.js';
import {assertOperatorArtifacts} from './operator-approval.js';
import {requireSession} from './routes/auth.js';
import {revisionAccess} from './private-revisions.js';
import {badRequest,forbidden,conflict,notFound,unauthorized} from './errors.js';
import {stringify} from './reviewed-artifacts.js';
type Params={wsId:string;id:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Authenticated provider-only typed consent, guarded by the registered reviewed composition. */
export async function operatorConsentRoutes(app:FastifyInstance,pool:pg.Pool,cfg:ApiConfig,runtime:ConfiguredRuntime,adapter:SyntheticAttemptAdapter){
 const schema=cfg.db.schema,dep=runtime.deployment;
 async function handle(req:Parameters<typeof requireSession>[0]&{params:Params;body?:{binding?:string;signature?:string}},accept:boolean){
  await assertOperatorArtifacts(adapter);const session=await requireSession(req,pool,schema),{wsId,id}=req.params;
  if(!uuid.test(wsId)||!uuid.test(id))throw badRequest('Invalid workspace/draft');
  const c=await pool.connect();try{
   await c.query('BEGIN');await revisionAccess(c,schema,session.sessionId,wsId,id,true,dep);
   const active=async()=>{const r=await c.query('SELECT member_address,chain_id FROM '+schema+'.sessions WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[session.sessionId]);if(!r.rows[0])throw unauthorized('Session expired or revoked');if(String(r.rows[0].chain_id)!==String(dep.chainId)||r.rows[0].member_address.toLowerCase()!==session.memberAddress.toLowerCase())throw forbidden('Session context changed');};
   await active();const row=(await c.query('SELECT * FROM '+schema+'.terms_drafts WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[id,wsId])).rows[0];if(!row)throw notFound('draft',id);
   const terms=parseTerms({...row.terms_json as SerializedTerms,schemaVersion:String(row.terms_json.schemaVersion)});if(terms.provider.toLowerCase()!==session.memberAddress.toLowerCase())throw forbidden('Authenticated draft provider required');
   if(!['draft','accepted'].includes(row.status)||terms.termsDocumentHash.toLowerCase()!==row.doc_hash.toLowerCase())throw conflict('Draft is unavailable or changed');
   const digest=computeTermsDigest(terms,dep),binding=keccak256(toHex(stringify({workspaceId:wsId,draftId:id,version:row.version,docHash:row.doc_hash,terms:serializeTerms(terms),policyHash:runtime.policyHash})));
   const existing=(await c.query('SELECT * FROM '+schema+'.accepted_consents WHERE draft_id=$1 AND workspace_id=$2 AND lower(signer_address)=lower($3)',[id,wsId,terms.provider])).rows[0];
   if(existing&&(existing.terms_digest.toLowerCase()!==digest.toLowerCase()||String(existing.chain_id)!==String(dep.chainId)))throw conflict('Stored consent differs from current draft');
   if(accept){
    const b=req.body;if(!b||Object.keys(b).sort().join()!=='binding,signature'||b.binding!==binding||typeof b.signature!=='string'||!/^0x(?:[0-9a-f]{2}){1,8192}$/i.test(b.signature))throw conflict('Exact reviewed binding and signature required');
    if(existing){if(existing.signature_hex.toLowerCase()!==b.signature.toLowerCase())throw conflict('Accepted consent is immutable');}
    else{
     if(row.status!=='draft')throw conflict('Accepted draft has no matching consent');
     const observed=await observeFactoryForCreation(runtime.consent.rpc,dep,terms.client as Hex,terms.clientNonce,terms);
     const issued=await issueProviderConsent(runtime.consent.rpc,terms,dep,b.signature as Hex,observed);if(!issued.consent)throw forbidden('Current canonical provider consent unavailable');
     await active();await revisionAccess(c,schema,session.sessionId,wsId,id,true,dep);await assertOperatorArtifacts(adapter);
     await createAcceptedConsent(c,schema,randomUUID(),id,wsId,terms.provider,digest,b.signature,issued.verifyResult.method as 'ecdsa'|'erc1271',observed.block.blockNumber,dep.chainId);
     await c.query('UPDATE '+schema+'.terms_drafts SET status=$2 WHERE id=$1',[id,'accepted']);
    }
   }
   const signature=accept?req.body!.signature:existing?.signature_hex;
   await active();await revisionAccess(c,schema,session.sessionId,wsId,id,true,dep);await c.query('COMMIT');
   return {source:'OPERATOR_CONFIGURED',policyHash:runtime.policyHash,workspaceId:wsId,draftId:id,version:row.version,docHash:row.doc_hash,binding,termsDigest:digest,terms:serializeTerms(terms),deployment:JSON.parse(stringify(dep)),typedData:JSON.parse(stringify(buildTypedData(terms,dep))),accepted:Boolean(existing||accept),signatureHash:signature?keccak256(signature as Hex):null};
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 }
 app.get<{Params:Params;Body:{binding?:string;signature?:string}}>('/workspaces/:wsId/drafts/:id/provider-consent',async(req,reply)=>reply.header('Cache-Control','no-store').send(await handle(req,false)));
 app.post<{Params:Params;Body:{binding?:string;signature?:string}}>('/workspaces/:wsId/drafts/:id/provider-consent',async(req,reply)=>reply.header('Cache-Control','no-store').send(await handle(req,true)));
}
