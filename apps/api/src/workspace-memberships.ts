import type {FastifyInstance} from 'fastify';
import type pg from 'pg';
import type {ApiConfig} from './config.js';
import {addMembership,getMembership} from '@noticevault/db';
import {requireSession} from './routes/auth.js';
import {associationMember} from './agreement-association.js';
import {mutateOnce} from './mutations.js';
import {badRequest,forbidden,notFound} from './errors.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function membershipRoutes(app:FastifyInstance,pool:pg.Pool,cfg:ApiConfig){
 const s=cfg.db.schema;
 const owner=async(c:pg.PoolClient,sid:string,ws:string)=>{const me=await associationMember(c,s,sid,ws);const m=await getMembership(c,s,ws,me.member_address,BigInt(me.chain_id));if(m?.role!=='owner')throw forbidden('Only the workspace owner may manage memberships');return me;};
 app.get<{Params:{wsId:string}}>('/workspaces/:wsId/memberships',async(req,reply)=>{
  const me=await requireSession(req,pool,s),ws=req.params.wsId;if(!uuid.test(ws))throw badRequest('Invalid workspace');const m=await getMembership(pool,s,ws,me.memberAddress,me.chainId);if(!m)throw forbidden('Workspace membership required');
  const r=await pool.query('SELECT m.id,m.role,m.member_address,m.chain_id,u.id AS user_id FROM '+s+'.workspace_memberships m LEFT JOIN '+s+'.wallet_identities u ON u.wallet_address=lower(m.member_address) AND u.chain_id=m.chain_id WHERE m.workspace_id=$1 ORDER BY m.joined_at,m.id',[ws]);return reply.header('Cache-Control','no-store').send({canManage:m.role==='owner',items:r.rows});
 });
 app.post<{Params:{wsId:string};Body:{userId:string;role:string}}>('/workspaces/:wsId/memberships',async(req,reply)=>{
  const me=await requireSession(req,pool,s),ws=req.params.wsId,b=req.body;if(!uuid.test(ws)||!b||!uuid.test(b.userId)||!['EDITOR','VIEWER'].includes(b.role)||Object.keys(b).some(k=>!['userId','role'].includes(k)))throw badRequest('Existing userId and EDITOR or VIEWER role required');
  if((await getMembership(pool,s,ws,me.memberAddress,me.chainId))?.role!=='owner')throw forbidden('Workspace owner required');
  const result=await mutateOnce(pool,s,me.memberAddress,me.chainId,req.headers['idempotency-key'],'POST /workspaces/'+ws+'/memberships',b,async(c)=>{
   await owner(c,me.sessionId,ws);const u=(await c.query('SELECT * FROM '+s+'.wallet_identities WHERE id=$1',[b.userId])).rows[0];if(!u)throw notFound('authenticated user',b.userId);
   const old=(await c.query('SELECT role FROM '+s+'.workspace_memberships WHERE workspace_id=$1 AND member_address=$2 AND chain_id=$3 FOR UPDATE',[ws,u.wallet_address,u.chain_id])).rows[0];if(old?.role==='owner')throw forbidden('Owner reassignment is outside this product flow');
   await addMembership(c,s,ws,u.wallet_address,b.role.toLowerCase() as 'editor'|'viewer',BigInt(u.chain_id));const row=(await c.query('SELECT id,role,member_address,chain_id FROM '+s+'.workspace_memberships WHERE workspace_id=$1 AND member_address=$2 AND chain_id=$3',[ws,u.wallet_address,u.chain_id])).rows[0];return {status:201,body:{...row,userId:b.userId}};
  });return reply.status(result.status).send(result.body);
 });
 app.delete<{Params:{wsId:string;id:string}}>('/workspaces/:wsId/memberships/:id',async(req,reply)=>{
  const me=await requireSession(req,pool,s),{wsId,id}=req.params;if(!uuid.test(wsId)||!uuid.test(id))throw badRequest('Invalid membership');const c=await pool.connect();try{await c.query('BEGIN');await owner(c,me.sessionId,wsId);const row=(await c.query('SELECT role FROM '+s+'.workspace_memberships WHERE id=$1 AND workspace_id=$2 FOR UPDATE',[id,wsId])).rows[0];if(row?.role==='owner')throw forbidden('Owner membership cannot be removed');await c.query('DELETE FROM '+s+'.workspace_memberships WHERE id=$1 AND workspace_id=$2',[id,wsId]);await c.query('COMMIT');return reply.status(204).send();}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 });
}
