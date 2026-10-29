import {ApiError} from './errors.js';
import type pg from 'pg';
import {canonicalCreation} from './agreement-association.js';
export type DeliveryResult={state:'accepted'|'delivered'|'failed';receipt?:string;retryable?:boolean};
/** Injected adapters must honor the immutable outbox ID as an idempotency key. No network adapter is shipped. */
export interface DeliveryAdapter{send(input:{key:string;destination:string;payload:unknown},signal:AbortSignal):Promise<DeliveryResult>;lookup(key:string,signal:AbortSignal):Promise<DeliveryResult|null>;}
async function eligible(c:pg.PoolClient,s:string,r:{workspace_id:string;user_id:string;destination_id:string;preference_version:number;stream_id:string;agreement:string;source:string;block_number:string;block_hash:string;category:string;payload:{details?:{checkpoint?:string}}}){
 const p=(await c.query('SELECT p.version,p.enabled,d.channel,d.target FROM '+s+'.notification_preferences p JOIN '+s+'.notification_destinations d ON d.id=p.destination_id AND d.user_id=p.user_id JOIN '+s+'.wallet_identities u ON u.id=p.user_id JOIN '+s+'.workspace_memberships m ON m.workspace_id=p.workspace_id AND m.chain_id=u.chain_id AND lower(m.member_address)=u.wallet_address WHERE p.workspace_id=$1 AND p.user_id=$2 AND p.destination_id=$3 AND d.verified_at IS NOT NULL AND d.revoked_at IS NULL FOR SHARE OF p,d,m',[r.workspace_id,r.user_id,r.destination_id])).rows[0];
 if(!p||!p.enabled||p.version!==r.preference_version)return null;
 const link=(await c.query('SELECT fingerprint FROM '+s+'.workspace_agreement_associations WHERE workspace_id=$1 AND stream_id=$2 AND agreement=$3',[r.workspace_id,r.stream_id,r.agreement])).rows[0];if(!link)return null;
 let proof;try{proof=await canonicalCreation(c,s,r.stream_id,r.agreement);}catch(e){if(e instanceof ApiError&&[404,409].includes(e.statusCode))return null;throw e;}if(proof.fingerprint!==link.fingerprint||proof.source!==r.source)return null;
 if(!(await c.query('SELECT 1 FROM '+s+'.indexer_blocks WHERE stream_id=$1 AND block_number=$2 AND block_hash=$3',[r.stream_id,r.block_number,r.block_hash])).rows.length)return null;
 if(r.category==='RenewalDue'){const f=(await c.query('SELECT f.funded_through,n.notice_start FROM '+s+'.indexed_funding f LEFT JOIN '+s+'.indexed_notice n USING(stream_id,agreement) WHERE f.stream_id=$1 AND f.agreement=$2',[r.stream_id,r.agreement])).rows[0];if(!f||f.notice_start!==null||String(f.funded_through)!==r.payload.details?.checkpoint)return null;}
 return p;
}
export async function deliverOutboxBatch(pool:pg.Pool,s:string,signal:AbortSignal,adapter?:DeliveryAdapter,limit=10){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(s)||!Number.isInteger(limit)||limit<1||limit>20)throw Error('OUTBOX_CONFIG');let processed=0;
 const ids=(await pool.query('SELECT id FROM '+s+".notification_outbox WHERE state IN ('queued','attempted','unknown','accepted') AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at,id LIMIT $1",[limit])).rows;
 for(const {id} of ids){if(signal.aborted)break;const c=await pool.connect();try{await c.query('BEGIN');const r=(await c.query('SELECT * FROM '+s+'.notification_outbox WHERE id=$1 FOR UPDATE SKIP LOCKED',[id])).rows[0];if(!r||!['queued','attempted','unknown','accepted'].includes(r.state)){await c.query('ROLLBACK');continue;}const destination=await eligible(c,s,r);
  if(!destination){await c.query('UPDATE '+s+".notification_outbox SET state='stale' WHERE id=$1",[id]);await c.query('COMMIT');continue;}
  if(destination.channel==='IN_APP'){await c.query('INSERT INTO '+s+'.notification_messages(outbox_id,user_id,workspace_id,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',[id,r.user_id,r.workspace_id,JSON.stringify(r.payload)]);await c.query('UPDATE '+s+".notification_outbox SET state='delivered',receipt=$2 WHERE id=$1",[id,'IN_APP:'+id]);await c.query('COMMIT');processed++;continue;}
  if(!adapter){await c.query('ROLLBACK');continue;}
  const send=r.state==='queued';if(send&&r.attempts>=8){await c.query('UPDATE '+s+".notification_outbox SET state='failed' WHERE id=$1",[id]);await c.query('COMMIT');continue;}
  if(send)await c.query('UPDATE '+s+".notification_outbox SET state='attempted',attempts=attempts+1,attempted_at=clock_timestamp() WHERE id=$1",[id]);await c.query('COMMIT');
  if(signal.aborted)break;
  await c.query('BEGIN');const locked=(await c.query('SELECT * FROM '+s+'.notification_outbox WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!await eligible(c,s,locked)){await c.query('UPDATE '+s+".notification_outbox SET state='stale' WHERE id=$1",[id]);await c.query('COMMIT');continue;}
  const stop=new AbortController(),cancel=()=>stop.abort(),timer=setTimeout(cancel,10000);signal.addEventListener('abort',cancel,{once:true});let result:DeliveryResult|null=null;
  try{if(signal.aborted)throw Error('DELIVERY_UNKNOWN');const operation=send?adapter.send({key:id,destination:destination.target,payload:r.payload},stop.signal):adapter.lookup(id,stop.signal);result=await Promise.race([operation,new Promise<never>((_,reject)=>stop.signal.addEventListener('abort',()=>reject(Error('DELIVERY_UNKNOWN')),{once:true}))]);}catch{result=null;}finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);}
  if(result&&(!['accepted','delivered','failed'].includes(result.state)||(result.state!=='failed'&&(!result.receipt||result.receipt.length>1024))))result=null;
  const state=result?.state==='failed'&&result.retryable&&locked.attempts<8?'queued':result?.state??'unknown';
  await c.query('UPDATE '+s+".notification_outbox SET state=$2,receipt=$3,next_attempt_at=clock_timestamp()+($4::integer*interval '1 second') WHERE id=$1",[id,state,result?.receipt??locked.receipt,Math.min(3600,30*2**locked.attempts)]);await c.query('COMMIT');processed++;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 return {processed};
}
