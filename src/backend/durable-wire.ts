import type {SerializedTerms} from '../../packages/sdk/src/types';
import type {DurableAttempt,DurablePreparation,DurableDiscoveryProgress,DurableApprovalOutcome,DurableNoticeOutcome,DurableFundingOutcome} from './durable-attempt';
import type {DurableBusinessOutcome} from './business-outcome';
type Guard<T>=(v:unknown)=>v is T;
const str:Guard<string>=(v):v is string=>typeof v==='string';
const num:Guard<number>=(v):v is number=>typeof v==='number'&&Number.isSafeInteger(v);
const bool:Guard<boolean>=(v):v is boolean=>typeof v==='boolean';
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function shape<T extends object>(fields:{[K in keyof T]-?:Guard<T[K]>}):Guard<T>{
 return (v:unknown):v is T=>record(v)&&(Object.keys(fields) as (keyof T&string)[]).every(k=>fields[k](v[k]));
}
function strings<K extends string>(...keys:K[]):{[P in K]:Guard<string>}{return Object.fromEntries(keys.map(k=>[k,str])) as {[P in K]:Guard<string>};}
function oneOf<T extends string|number>(...values:T[]):Guard<T>{return (v:unknown):v is T=>values.some(x=>x===v);}
function optional<T>(guard:Guard<T>):Guard<T|undefined>{return (v:unknown):v is T|undefined=>v===undefined||guard(v);}
function nullable<T>(guard:Guard<T>):Guard<T|null>{return (v:unknown):v is T|null=>v===null||guard(v);}
function either<A,B>(a:Guard<A>,b:Guard<B>):Guard<A|B>{return (v:unknown):v is A|B=>a(v)||b(v);}
const stringRecord:Guard<Record<string,string>>=(v):v is Record<string,string>=>record(v)&&Object.values(v).every(str);
const terms=shape<SerializedTerms>(strings('schemaVersion','client','provider','token','amountPerPeriod','periodSeconds','noticeSeconds','startAt','clientNonce','acceptanceDeadline','termsDocumentHash'));
const preparation=shape<DurablePreparation>({
 ...strings('workspaceId','actor','chainId','resource','action','policyHash','cycleKey','networkNonce','target','data'),value:oneOf('0'),issuedAt:num,
 discoveryAnchor:optional(shape({blockNumber:str,blockHash:str})),
 settlement:optional(shape({...strings('agreement','streamId','fingerprint','amount','noticeReason','callerRule'),terms,recipient:nullable(str),noticeStart:nullable(str),noticeEnd:nullable(str),accounting:stringRecord})),
 renewal:optional(shape({...strings('agreement','streamId','fingerprint','expectedD','regularFunded','amount'),terms})),
 creation:optional(shape({draftVersion:num,docHash:str})),
 business:optional(shape({termsHash:str,agreementCodeHash:str,termsDigest:optional(str)})),
 funding:optional(shape(strings('termsHash','agreementCodeHash','regularFunded','fundedThrough'))),
 notice:optional(shape(strings('termsHash','agreementCodeHash','regularFunded','fundedThrough'))),
 approval:optional(shape(strings('spender','amount')))
});
const approval=shape<DurableApprovalOutcome>({kind:oneOf('ALLOWANCE_CHANGED'),...strings('owner','spender','approvedAmount','currentAllowance','allowanceBlockNumber','allowanceBlockHash')});
const notice=shape<DurableNoticeOutcome>({kind:oneOf('STATE_CHANGED','NO_CHANGE'),action:oneOf('start-notice','materialize-notice'),...strings('agreement','client','provider','token','termsHash','regularFunded','fundedThrough','noticeStart','noticeEnd'),reason:oneOf('CLIENT_CANCELLED','MISSED_CHECKPOINT')});
const funding=shape<DurableFundingOutcome>({kind:oneOf('STATE_CHANGED'),action:oneOf('fund-renewal'),...strings('agreement','client','token','termsHash','fundedAmount','periodSeconds','previousRegularFunded','newRegularFunded','previousFundedThrough','newFundedThrough','observedRegularFunded','observedLiability','observedBalance','observedAllowance')});
const businessBase=strings('agreement','factory','client','provider','token','termsHash','noticeReserve','observedRegularFunded','observedRegularPaid','observedNoticePaid','observedClientRefunded','observedLiability','observedBalance');
const business:Guard<DurableBusinessOutcome>=either(shape<Extract<DurableBusinessOutcome,{action:'create-agreement'}>>({...businessBase,kind:oneOf('STATE_CHANGED'),action:oneOf('create-agreement'),...strings('initialRegular','depositedAmount','clientNonce','termsDigest')}),shape<Exclude<DurableBusinessOutcome,{action:'create-agreement'}>>({...businessBase,kind:oneOf('TRANSFER','NO_CHANGE'),action:oneOf('claim-provider','claim-client-refund'),...strings('recipient','amount','regularAmount','noticeAmount'),noticeMaterialized:bool}));
const discovery=shape<DurableDiscoveryProgress>({version:oneOf(1),...strings('binding','policyHash','anchorBlock','anchorHash','nextBlock'),checkpointBlock:optional(str),checkpointHash:optional(str),candidateHash:optional(str),revision:num,status:oneOf('searching','caught_up','found','reorged','conflicted')});
/** Structural wire validation; existing semantic/canonical checks remain authoritative. */
const outcome=either(approval,either(notice,either(funding,business)));
const proof=shape({blockNumber:str,blockHash:str,outcome:optional(outcome)});
export const isDurableAttempt=shape<DurableAttempt>({source:oneOf('SYNTHETIC','OPERATOR_CONFIGURED'),...strings('id','workspaceId','account','chainId','resource','action','binding'),state:oneOf('reserved','unknown','submitted','confirmed','reverted','reorged','conflicted','cancelled'),revision:num,hash:nullable(str),claimed:optional(bool),discovery:optional(nullable(discovery)),preparation,proof:optional(nullable(proof))});
