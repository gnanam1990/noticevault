// @ts-check
/** @param {string} schema @param {string[]} [workspaceIds] */
export function operationalSnapshotSql(schema,workspaceIds){
 if(typeof schema!=='string'||!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('INVALID_SCHEMA');
 if(workspaceIds&&(!workspaceIds.length||workspaceIds.length>100||!Array.isArray(workspaceIds)||workspaceIds.some(x=>typeof x!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x))))throw Error('INVALID_SCOPE');
 /** @param {string} alias */
const scope=alias=>workspaceIds?alias+".workspace_id IN ("+workspaceIds.map(x=>"'"+x+"'::uuid").join(',')+")":'TRUE';
 const streamScope=workspaceIds?'EXISTS(SELECT 1 FROM '+schema+'.workspace_agreement_associations a WHERE a.stream_id=s.stream_id AND '+scope('a')+')':'TRUE';
 /** @param {string} condition */
const attempt=condition=>'(SELECT count(*) FROM '+schema+'.transaction_attempts a WHERE '+scope('a')+' AND '+condition+')';
 /** @param {string} state */
const delivery=state=>"(SELECT count(*) FROM "+schema+".notification_outbox a WHERE "+scope('a')+" AND state='"+state+"')";
 const metrics=[
 "'observedStreams',(SELECT count(*) FROM "+schema+".indexer_streams s WHERE s.source='RPC_OBSERVED' AND "+streamScope+')',
 "'maxObservedLagSeconds',(SELECT max(greatest(0,extract(epoch FROM clock_timestamp())-b.observed_timestamp)) FROM "+schema+'.indexer_streams s JOIN '+schema+".indexer_blocks b ON b.stream_id=s.stream_id AND b.block_number=s.head_number WHERE s.source='RPC_OBSERVED' AND "+streamScope+')',
 "'unknownAttempts',"+attempt("a.state='unknown'"),
 "'oldestUnknownAgeSeconds',(SELECT max(extract(epoch FROM clock_timestamp()-a.updated_at)) FROM "+schema+".transaction_attempts a WHERE "+scope('a')+" AND a.state='unknown')",
 "'conflictedAttempts',"+attempt("a.state IN ('conflicted','reorged')"),
 "'revertedTransferActions',"+attempt("a.state='reverted' AND a.action IN ('create-agreement','fund-renewal','claim-provider','claim-client-refund')"),
 "'failedDeliveries',"+delivery('failed'),"'unknownDeliveries',"+delivery('unknown'),
 "'upcomingCheckpoints',(SELECT count(DISTINCT (f.stream_id,f.agreement)) FROM "+schema+'.indexed_funding f JOIN '+schema+'.indexer_streams s USING(stream_id) JOIN '+schema+'.indexer_blocks b ON b.stream_id=s.stream_id AND b.block_number=s.head_number JOIN '+schema+'.workspace_agreement_associations a ON a.stream_id=f.stream_id AND a.agreement=f.agreement LEFT JOIN '+schema+".indexed_notice n ON n.stream_id=f.stream_id AND n.agreement=f.agreement WHERE "+scope('a')+" AND s.source='RPC_OBSERVED' AND n.notice_start IS NULL AND f.funded_through>b.observed_timestamp AND f.funded_through<=b.observed_timestamp+3600 AND extract(epoch FROM clock_timestamp())-b.observed_timestamp BETWEEN 0 AND 300)"
 ];return 'SELECT json_build_object('+metrics.join(',')+') AS snapshot';
}
/** @param {unknown} value */
export function evaluateOperationalSignals(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('INVALID_COUNTERS');
 const input=/** @type {Record<string,unknown>} */(value);
 /** @type {Record<string,number|null>} */const s={};
 for(const key of ['observedStreams','maxObservedLagSeconds','unknownAttempts','oldestUnknownAgeSeconds','conflictedAttempts','failedDeliveries','unknownDeliveries','upcomingCheckpoints','revertedTransferActions']){
  const v=input[key],age=key==='maxObservedLagSeconds'||key==='oldestUnknownAgeSeconds';
  if(v===null&&age){s[key]=null;continue;}
  if(typeof v!=='number'||!Number.isFinite(v)||v<0||(!age&&!Number.isSafeInteger(v)))throw Error('INVALID_COUNTERS');s[key]=v;
 }

 const alerts=[];if(Number(s.observedStreams)===0)alerts.push('NO_OBSERVED_CHAIN_STREAM');if(s.maxObservedLagSeconds===null)alerts.push('OBSERVED_LAG_UNAVAILABLE');else if(Number(s.maxObservedLagSeconds)>300)alerts.push('INDEXER_LAG');
 if(Number(s.unknownAttempts)>0)alerts.push('UNKNOWN_ATTEMPTS_LOCKED');if(Number(s.oldestUnknownAgeSeconds)>3600)alerts.push('UNKNOWN_ATTEMPTS_OLDER_THAN_ONE_HOUR');if(Number(s.conflictedAttempts)>0)alerts.push('CONFLICTED_ATTEMPTS');
 if(Number(s.failedDeliveries)>0)alerts.push('DELIVERY_FAILURE');if(Number(s.unknownDeliveries)>0)alerts.push('UNKNOWN_DELIVERY_NO_RESEND');if(Number(s.upcomingCheckpoints)>0)alerts.push('CHECKPOINT_WITHIN_ONE_HOUR');if(Number(s.revertedTransferActions)>0)alerts.push('TRANSFER_ACTION_REVERTED');
 return {status:alerts.length?'ATTENTION':'LOCAL_COUNTERS_CLEAR',alerts,counters:s,liveReadiness:'NOT_ASSERTED',rpcDisagreement:'USE_PAIRED_RUNTIME_OR_PREFLIGHT',capHeadroom:'USE_VERIFIED_DEPLOYED_FACTORY_PREFLIGHT',transferFailureMeaning:'Canonical reverted transfer action; token-specific cause is not inferred.',identifiersRedacted:true};
}
