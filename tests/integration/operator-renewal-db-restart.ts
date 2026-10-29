import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPool} from '../../packages/db/src/index';
const saved=JSON.parse(await readFile('/tmp/operator-renewal-restart.json','utf8'));
const schema='nv_operator_renewal_it_fund_deny';assert.equal(saved.schema,schema);
const pool=createPool({host:'/tmp/nv-socket',port:5432,user:'postgres',password:'',database:'noticevault_renewal_it',schema});
try{
 const r=await pool.query('SELECT state,revision,preparation FROM '+schema+'.transaction_attempts WHERE id=$1',[saved.id]);assert.equal(r.rows[0].state,'unknown');assert.ok(r.rows[0].revision>=1);assert.equal(r.rows[0].preparation.source,'OPERATOR_CONFIGURED');
 const events=await pool.query('SELECT count(*)::int AS n FROM '+schema+'.transaction_attempt_events WHERE attempt_id=$1',[saved.id]);assert.ok(events.rows[0].n>=1);
 const confirmed=await pool.query('SELECT count(*)::int AS n FROM '+schema+".transaction_attempts WHERE state='confirmed'");assert.equal(confirmed.rows[0].n,5);
 console.log('PASS PostgreSQL process restart preserves unknown lock, history and canonical terminal evidence');
}finally{await pool.end();}
