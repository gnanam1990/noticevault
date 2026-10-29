import {describe,it,expect,vi,afterEach} from 'vitest';
import {keccak256} from 'viem';
import type {Hex} from 'viem';
import {observeFactoryForCreation} from './snapshot.js';
import type {MinimalPublicClient} from './snapshot.js';
import type {NoticeVaultDeployment,TermsInput} from './types.js';
import {draftCreationBinding,prepareBoundDraftCreation} from './draft-consent.js';
const F="0x2222222222222222222222222222222222222222",T="0x3333333333333333333333333333333333333333",C="0x1111111111111111111111111111111111111111",P="0x4444444444444444444444444444444444444444";
const FC="0x60006000" as Hex,TC="0x60016001" as Hex,H=("0x"+"aa".repeat(32)) as Hex;
function fixture(opts:{values?:Record<string,unknown>;fail?:string;block?:Record<string,unknown>;recheck?:Record<string,unknown>;providerCode?:unknown}={}) {
 const now=BigInt(Math.floor(Date.now()/1000));
 const dep:NoticeVaultDeployment={configIdentity:"ARC_TESTNET",chainId:31337n,factoryAddress:F,allowlistedToken:T,expectedFactoryCodeHash:keccak256(FC),expectedTokenCodeHash:keccak256(TC),isLive:false,label:"Synthetic T024"};
 const terms:TermsInput={schemaVersion:1,client:C,provider:P,token:T,amountPerPeriod:3000000n,periodSeconds:2592000n,noticeSeconds:864000n,startAt:now+600n,clientNonce:7n,acceptanceDeadline:now+1000n,termsDocumentHash:H};
 const reads:Array<{functionName:string;address:string;blockNumber:bigint}>=[];
 const block={number:123n,hash:H,timestamp:now,...opts.block};
 const values:Record<string,unknown>={token:T,decimals:6,factoryCap:100000000n,agreementCap:100000000n,outstandingLiability:0n,creationPaused:false,isNonceUnavailable:false,balanceOf:100000000n,allowance:100000000n,...opts.values};
 const rpc:MinimalPublicClient={getChainId:async()=>31337,getBlock:async args=>({...block,...('blockNumber' in args?opts.recheck:{})}) as never,getBytecode:async({address})=>address.toLowerCase()===F?FC:address.toLowerCase()===T?TC:('providerCode' in opts?opts.providerCode:"0x") as Hex,readContract:async args=>{reads.push({functionName:args.functionName,address:args.address,blockNumber:args.blockNumber});if(args.functionName===opts.fail)throw new Error("Injected failure");return values[args.functionName];}};
 return {dep,terms,rpc,reads,now,observe:()=>observeFactoryForCreation(rpc,dep,C,7n,terms)};
}


const SIG='0x1234' as Hex;
function setup(){
 const f=fixture({providerCode:'0x6000',values:{isValidSignature:'0x1626ba7e'}});
 const draft={workspaceId:'workspace-1',draftId:'draft-1',version:1,docHash:H,status:'accepted',terms:f.terms,signature:SIG};
 const wallet={account:C,chainId:f.dep.chainId};
 const deps={deployment:f.dep,rpc:f.rpc,loadCurrent:async()=>draft,readWallet:async()=>wallet};
 return {f,draft,wallet,deps,binding:draftCreationBinding(draft,f.dep)};
}
afterEach(()=>vi.restoreAllMocks());
describe('T031 authoritative draft consent bridge',()=>{
 it('prepares only from actual issued factory and consent evidence',async()=>{const x=setup();const r=await prepareBoundDraftCreation(x.binding,x.deps);expect(r.request.functionName).toBe('createAgreement');expect(r.request.to).toBe(F);expect(r.binding).toBe(x.binding);expect(x.f.reads.some(r=>r.functionName==='isValidSignature')).toBe(true);});
 it.each(['version','docHash','workspaceId','draftId','status','signature'])('rejects changed draft %s',async key=>{const x=setup();Object.assign(x.draft,{[key]:key==='version'?2:key==='status'?'draft':'changed'});await expect(prepareBoundDraftCreation(x.binding,x.deps)).rejects.toThrow();});
 it('rejects terms substitution',async()=>{const x=setup();x.draft.terms={...x.draft.terms,amountPerPeriod:4000000n};await expect(prepareBoundDraftCreation(x.binding,x.deps)).rejects.toThrow();});
 it('rejects policy substitution',async()=>{const x=setup();x.deps.deployment={...x.deps.deployment,expectedFactoryCodeHash:H};await expect(prepareBoundDraftCreation(x.binding,x.deps)).rejects.toThrow();});
 it('rejects version changed during verification',async()=>{const x=setup();let calls=0;x.deps.loadCurrent=async()=>++calls===1?x.draft:{...x.draft,version:2};await expect(prepareBoundDraftCreation(x.binding,x.deps)).rejects.toThrow();});
 it('rejects switched wallet account or chain',async()=>{for(const change of [{account:P},{chainId:1n}]){const x=setup();Object.assign(x.wallet,change);await expect(prepareBoundDraftCreation(x.binding,x.deps)).rejects.toThrow();}});
 it('rejects wallet change during verification',async()=>{const x=setup();let calls=0;x.deps.readWallet=async()=>++calls===1?x.wallet:{...x.wallet,account:P};await expect(prepareBoundDraftCreation(x.binding,x.deps)).rejects.toThrow();});
 it('rejects expired acceptance',async()=>{const x=setup();x.draft.terms={...x.draft.terms,acceptanceDeadline:x.f.now-1n};await expect(prepareBoundDraftCreation(draftCreationBinding(x.draft,x.f.dep),x.deps)).rejects.toThrow();});
 it('rejects reorg during provider verification',async()=>{const x=setup();let calls=0;const get=x.f.rpc.getBlock;x.f.rpc.getBlock=async a=>{const b=await get(a as never);return ++calls>2?{...b,hash:('0x'+'bb'.repeat(32)) as Hex}:b;};await expect(prepareBoundDraftCreation(x.binding,x.deps)).rejects.toThrow();});
});
