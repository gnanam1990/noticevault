import assert from 'node:assert/strict';
import {createPool} from '../../packages/db/src/index';
const pool=createPool({host:'/tmp/nv-socket',port:5432,user:'postgres',password:'',database:'noticevault_settlement_it',schema:'public'});
try{
 for(const action of ['start-notice','materialize-notice','claim-provider','claim-client-refund'])for(const scenario of ['positive','claim','wallet','deny',...(action.startsWith('claim-')?['noop']:[])]){
  const schema='nv_settlement_'+action.replaceAll('-','_')+'_'+scenario,state=['positive','noop'].includes(scenario)?'confirmed':'unknown';
  const r=await pool.query('SELECT id,state,revision,preparation FROM '+schema+'.transaction_attempts WHERE state=$1',[state]);assert.equal(r.rows.length,1);assert.ok(r.rows[0].revision>=1);assert.equal(r.rows[0].preparation.source,'OPERATOR_CONFIGURED');
  const events=await pool.query('SELECT count(*)::int AS n FROM '+schema+'.transaction_attempt_events WHERE attempt_id=$1',[r.rows[0].id]);assert.ok(events.rows[0].n>=1);
 }
 console.log('PASS PostgreSQL restart preserves 18 settlement scenarios and canonical evidence');
}finally{await pool.end();}
