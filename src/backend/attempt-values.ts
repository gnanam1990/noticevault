import type {Attempt,SubmissionReview} from './transaction-review';
import type {DurableJournal} from './durable-review';
import {objectValue,stringValue,parseObject,arrayValue} from './response-values';
export function parseAttempt(value:unknown):Attempt {
 const a=objectValue(value),key=stringValue(a.key),chainId=stringValue(a.chainId),status=a.status;
 if(a.source!=='SYNTHETIC'||!key||!/^[1-9][0-9]*$/.test(chainId)||(status!=='unknown'&&status!=='submitted'&&status!=='confirmed'&&status!=='reverted'&&status!=='rejected'))throw Error('Corrupt synthetic journal; preserved');
 const hash=a.hash===undefined?undefined:stringValue(a.hash);
 if(hash!==undefined&&!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Corrupt synthetic hash; preserved');
 let request:SubmissionReview|undefined,durable:DurableJournal|undefined;
 if(a.request!==undefined){const r=objectValue(a.request);if(r.source!=='SYNTHETIC'||r.value!=='0')throw Error('Invalid saved review');request={...r,source:'SYNTHETIC',value:'0',key:stringValue(r.key),account:stringValue(r.account),chainId:stringValue(r.chainId),target:stringValue(r.target),data:stringValue(r.data),...(r.scopeKey===undefined?{}:{scopeKey:stringValue(r.scopeKey)}),...(r.cycleKey===undefined?{}:{cycleKey:stringValue(r.cycleKey)})};}
 if(a.durable!==undefined){const d=objectValue(a.durable),phase=d.phase;if(phase!=='reserving'&&phase!=='reserved'&&phase!=='claiming'&&phase!=='claimed'&&phase!=='resolved')throw Error('Invalid durable journal');durable={...d,phase,requestId:stringValue(d.requestId),workspaceId:stringValue(d.workspaceId),resource:stringValue(d.resource),action:stringValue(d.action),policyHash:stringValue(d.policyHash),...(d.id===undefined?{}:{id:stringValue(d.id)}),...(d.binding===undefined?{}:{binding:stringValue(d.binding)})};}
 return {...a,source:'SYNTHETIC',key,chainId,status,...(hash===undefined?{}:{hash}),...(request===undefined?{}:{request}),...(durable===undefined?{}:{durable})};
}
export function parseAttemptText(raw:string):Attempt{return parseAttempt(parseObject(raw));}
export function parseAttemptEntries<A extends string>(raw:string,actions:readonly A[]):{action:A;attempt:Attempt}[]{
 const value:unknown=JSON.parse(raw);
 return arrayValue(value).map(v=>{const e=objectValue(v),action=actions.find(a=>a===e.action);if(action===undefined)throw Error('Unknown journal action');return {action,attempt:parseAttempt(e.attempt)};});
}
