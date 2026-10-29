import type pg from 'pg';
import {isDeepStrictEqual} from 'node:util';
import {reconcilePersistedDiscovery} from './persisted-discovery.js';
import {reconcileCanonical} from './attempt-evidence.js';
import type {AttemptPreparation,SyntheticAttemptAdapter} from './attempt-evidence.js';
export type Row={id:string;workspace_id:string;actor:string;chain_id:string;resource:string;action:string;binding:string;preparation:AttemptPreparation;state:string;tx_hash:string|null;proof:unknown;revision:number;discovery?:unknown};
 export async function transitionAttempt(c:pg.PoolClient,s:string,r:Row,state:string,hash?:string,proof:unknown=null){const txHash=hash??r.tx_hash;if(r.state===state&&r.tx_hash===txHash&&isDeepStrictEqual(r.proof,proof))return r;
 const next=(await c.query<Row>('UPDATE '+s+'.transaction_attempts SET state=$2,tx_hash=$3,proof=$4::jsonb,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[r.id,state,txHash,JSON.stringify(proof)])).rows[0]!;
 await c.query('INSERT INTO '+s+'.transaction_attempt_events(attempt_id,from_state,to_state,proof,revision) VALUES($1,$2,$3,$4::jsonb,$5)',[r.id,r.state,state,JSON.stringify(proof),next.revision]);return next;
 }
 export async function reconcileAttempt(c:pg.PoolClient,s:string,r:Row,adapter:SyntheticAttemptAdapter){if(['reserved','cancelled'].includes(r.state))return r;const evidence=adapter.discovery?await reconcilePersistedDiscovery(c,s,r,adapter):await reconcileCanonical(adapter,r.preparation,r.tx_hash);r=(await c.query<Row>('SELECT * FROM '+s+'.transaction_attempts WHERE id=$1',[r.id])).rows[0]!;let state:string=evidence.state;
 if(['confirmed','reverted'].includes(r.state)){if(state==='unknown'||state==='submitted')state='reorged';else if(['confirmed','reverted'].includes(state)&&state!==r.state)state='conflicted';}
 return transitionAttempt(c,s,r,state,evidence.hash,evidence.proof??null);
 }
