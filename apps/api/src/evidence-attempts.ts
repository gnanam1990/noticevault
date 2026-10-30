import type pg from 'pg';
type Scope={workspaceId:string;chainId:string;streamId:string;agreement:string;revisionId?:string|undefined};
type Row=Record<string,any>;
/** The caller must first authorize the session, chain and exact workspace/stream association. */
export async function evidenceAttempts(client:Pick<pg.PoolClient,'query'>,schema:string,scope:Scope){
 if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('Invalid schema');
 const agreementResource='agreement:'+scope.agreement.toLowerCase(),draftResource=scope.revisionId?'draft:'+scope.revisionId:null;
 const rows=(await client.query('SELECT id,resource,preparation,action,state,tx_hash,proof,revision,created_at,updated_at FROM '+schema+'.transaction_attempts WHERE workspace_id=$1 AND chain_id=$2 AND resource=ANY($3) ORDER BY created_at,id LIMIT 501',[scope.workspaceId,scope.chainId,[agreementResource,...(draftResource?[draftResource]:[])]] )).rows as Row[];
 let unbound=0;
 const selected=rows.slice(0,500).filter(row=>{
  if(draftResource&&row.resource===draftResource)return true; // revisionAccess already authorized this exact immutable revision
  const p=row.preparation;
  if(!p||p.workspaceId!==scope.workspaceId||p.chainId!==scope.chainId||p.resource!==agreementResource){unbound++;return false;}
  const bindings=[p.renewal,p.settlement].filter(x=>x!==undefined);
  if(!bindings.length||bindings.some(x=>!x||typeof x.streamId!=='string'||typeof x.agreement!=='string'||x.agreement.toLowerCase()!==scope.agreement.toLowerCase())||new Set(bindings.map(x=>x.streamId)).size!==1){unbound++;return false;}
  return bindings[0].streamId===scope.streamId;
 }).map(({resource:_resource,preparation:_preparation,...row})=>row);
 return {rows:selected,unbound,truncated:rows.length>500};
}
