import type pg from 'pg';
import type {SyntheticAttemptAdapter} from './attempt-evidence.js';
import {preparationBinding} from './attempt-evidence.js';
import {reconcileAttempt,type Row} from './attempt-reconciliation.js';
/** Never reserves, claims, cancels, signs, broadcasts or clears a nonce. */
export async function reconcileBackgroundBatch(pool:pg.Pool,schema:string,adapter:SyntheticAttemptAdapter,signal:AbortSignal,limit=10){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema)||!Number.isSafeInteger(limit)||limit<1||limit>20||!adapter.discovery)throw Error('BACKGROUND_DISCOVERY_CONFIG');
 const source=adapter.source==='SYNTHETIC'?'SYNTHETIC':'OPERATOR_CONFIGURED',d=adapter.discovery;
 const candidates=(await pool.query<Row>('SELECT * FROM '+schema+".transaction_attempts WHERE state IN ('unknown','submitted','reorged','conflicted') AND preparation->>'source'=$1 AND preparation->>'policyHash'=$2 AND chain_id=$3 ORDER BY discovery_checked_at NULLS FIRST,id LIMIT $4",[source,d.policyHash,String(d.policy.chainId),limit])).rows;
 let checked=0,failed=0;
 for(const candidate of candidates){if(signal.aborted)break;const c=await pool.connect();try{
  await c.query('BEGIN');const lock=await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',['attempt:'+candidate.chain_id+':'+candidate.actor+':'+candidate.resource]);
  if(!lock.rows[0]?.acquired){await c.query('ROLLBACK');continue;}
  const r=(await c.query<Row>('SELECT * FROM '+schema+'.transaction_attempts WHERE id=$1 FOR UPDATE SKIP LOCKED',[candidate.id])).rows[0];
  if(!r||!['unknown','submitted','reorged','conflicted'].includes(r.state)){await c.query('ROLLBACK');continue;}
  const p=r.preparation;if(preparationBinding(p)!==r.binding||p.actor!==r.actor||p.chainId!==r.chain_id||p.workspaceId!==r.workspace_id||p.resource!==r.resource||p.action!==r.action||p.source!==source||p.policyHash!==d.policyHash)throw Error('BACKGROUND_ATTEMPT_BINDING');
  await reconcileAttempt(c,schema,r,adapter);if(signal.aborted){await c.query('ROLLBACK');break;}
  await c.query('UPDATE '+schema+'.transaction_attempts SET discovery_checked_at=clock_timestamp() WHERE id=$1',[r.id]);await c.query('COMMIT');checked++;
 }catch{await c.query('ROLLBACK');await c.query('UPDATE '+schema+'.transaction_attempts SET discovery_checked_at=clock_timestamp() WHERE id=$1',[candidate.id]);failed++;}finally{c.release();}}
 return {checked,failed};
}
