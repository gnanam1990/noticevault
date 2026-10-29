import { createHash } from 'node:crypto';
import type pg from 'pg';
import { badRequest, conflict } from './errors.js';

type Result = { status: number; body: unknown };
function canonical(value: unknown): string {
 if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
 if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
 return JSON.stringify(value);
}
/** Call only after session, membership and payload validation. Receipt and write commit together. */
export async function mutateOnce(pool: pg.Pool, schema: string, actor: string, chain: string | number | bigint, key: unknown, operation: string, payload: unknown, apply: (client: pg.PoolClient) => Promise<Result>): Promise<Result> {
 if (typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) throw badRequest('Idempotency-Key must be a UUID');
 const identity = [actor.toLowerCase(), String(chain), key.toLowerCase()];
 const hash = createHash('sha256').update(canonical(payload)).digest('hex');
 const client = await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [identity.join(':')]);
  const prior = await client.query('SELECT operation, request_hash, status, response_json FROM ' + schema + '.mutation_receipts WHERE actor_address=$1 AND chain_id=$2 AND request_key=$3', identity);
  if (prior.rows.length) {
   const row = prior.rows[0];
   if (row.operation !== operation || row.request_hash !== hash) throw conflict('Idempotency key already belongs to another request');
   await client.query('COMMIT');
   return { status: row.status, body: row.response_json };
  }
  const result = await apply(client);
  await client.query('INSERT INTO ' + schema + '.mutation_receipts(actor_address,chain_id,request_key,operation,request_hash,status,response_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)', [...identity, operation, hash, result.status, JSON.stringify(result.body)]);
  await client.query('COMMIT');
  return result;
 } catch (error) {
  try { await client.query('ROLLBACK'); } catch { /* Preserve original error. */ }
  throw error;
 } finally { client.release(); }
}
