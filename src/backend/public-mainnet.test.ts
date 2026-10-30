import {describe,it,expect,vi} from 'vitest';
import {encodeAbiParameters,parseAbiParameters,toFunctionSelector,keccak256} from 'viem';
vi.mock('../../packages/sdk/src/deployments',async()=>{const actual=await vi.importActual<typeof import('../../packages/sdk/src/deployments')>('../../packages/sdk/src/deployments');return {...actual,ARC_MAINNET_DEPLOYMENT:{...actual.ARC_MAINNET_DEPLOYMENT,expectedFactoryCodeHash:keccak256('0x6000'),expectedTokenCodeHash:keccak256('0x6001')}};});
import {FACTORY,MAINNET_RPC,readPublicMainnet,snapshotIsFresh} from './public-mainnet';
const now=1_800_000_000_000,hash='0x'+'ab'.repeat(32),block={number:'0x20',hash,timestamp:'0x'+(now/1000).toString(16)};
const fields:Record<string,[string,unknown]>={guardian:['address','0xFf525D6940Ad0e308ed6eda443c792694353F9Da'],token:['address','0x3600000000000000000000000000000000000000'],factoryCap:['uint256',10000000n],agreementCap:['uint256',1000000n],outstandingLiability:['uint256',0n],creationPaused:['bool',false],decimals:['uint8',6]};
function transport(change?:(method:string,params:any[],value:any,occurrence:number)=>any){const calls:{method:string;params:any[]}[]=[];let blocks=0;const fetcher=vi.fn(async(url:RequestInfo|URL,options?:RequestInit)=>{expect(url).toBe(MAINNET_RPC);expect(options?.credentials).toBe('omit');const req=JSON.parse(String(options?.body));calls.push(req);let result:any;
 if(req.method==='eth_chainId')result='0x13b2';
 else if(req.method==='eth_getBlockByNumber'){++blocks;result=block;}
 else if(req.method==='eth_getCode')result=req.params[0]===FACTORY?'0x6000':'0x6001';
 else if(req.method==='eth_call'){const found=Object.entries(fields).find(([name])=>toFunctionSelector(name+'()')===req.params[0].data);if(!found)throw Error('Unexpected call');const [type,value]=found[1];result=encodeAbiParameters(parseAbiParameters(type),[value] as any);}
 else throw Error('Unexpected method');
 result=change?change(req.method,req.params,result,blocks):result;return new Response(JSON.stringify({jsonrpc:'2.0',id:req.id,result}));});return {fetcher:fetcher as typeof fetch,calls};}
describe('public mainnet reads',()=>{
 it('reads one pinned block using only public read methods, with no wallet access',async()=>{const t=transport(),s=await readPublicMainnet(undefined,t.fetcher,()=>now);expect(s.blockNumber).toBe('32');expect(s.outstandingLiability).toBe(0n);expect(snapshotIsFresh(s,now)).toBe(true);for(const c of t.calls.filter(c=>['eth_call','eth_getCode'].includes(c.method)))expect(c.params[1]).toBe('0x20');expect(t.calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call'].includes(c.method))).toBe(true);});
 it('rejects the wrong chain before reading contracts',async()=>{const t=transport((m,p,v)=>m==='eth_chainId'?'0x1':v);await expect(readPublicMainnet(undefined,t.fetcher,()=>now)).rejects.toThrow('wrong chain');expect(t.calls).toHaveLength(1);});
 it('rejects mismatched runtime code',async()=>{const t=transport((m,p,v)=>m==='eth_getCode'?'0x6002':v);await expect(readPublicMainnet(undefined,t.fetcher,()=>now)).rejects.toThrow('Contract code');});
 it('rejects missing deployed code',async()=>{const t=transport((m,p,v)=>m==='eth_getCode'?'0x':v);await expect(readPublicMainnet(undefined,t.fetcher,()=>now)).rejects.toThrow();});
 it('rejects identity mismatch',async()=>{const t=transport((m,p,v)=>m==='eth_call'&&p[0].data===toFunctionSelector('token()')?encodeAbiParameters(parseAbiParameters('address'),['0x'+'11'.repeat(20)] as any):v);await expect(readPublicMainnet(undefined,t.fetcher,()=>now)).rejects.toThrow('identity');});
 it('rejects a reorg during the snapshot',async()=>{const t=transport((m,p,v,n)=>m==='eth_getBlockByNumber'&&n===2?{...v,hash:'0x'+'cd'.repeat(32)}:v);await expect(readPublicMainnet(undefined,t.fetcher,()=>now)).rejects.toThrow('Chain changed');});
 it('rejects old blocks',async()=>{const t=transport();await expect(readPublicMainnet(undefined,t.fetcher,()=>now+121000)).rejects.toThrow('outdated');});
 it('rejects future blocks',async()=>{const t=transport();await expect(readPublicMainnet(undefined,t.fetcher,()=>now-31000)).rejects.toThrow('outdated');});
 it('expires previously displayed data',async()=>{const t=transport(),s=await readPublicMainnet(undefined,t.fetcher,()=>now);expect(snapshotIsFresh(s,now+121000)).toBe(false);});
 it('does not replace failures with invented zero data',async()=>{await expect(readPublicMainnet(undefined,async()=>new Response('',{status:503}),()=>now)).rejects.toThrow('unavailable');});
 it('rejects mismatched response IDs',async()=>{await expect(readPublicMainnet(undefined,async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:999,result:'0x13b2'})),()=>now)).rejects.toThrow('invalid response');});
 it('passes cancellation to every read',async()=>{const controller=new AbortController();controller.abort();await expect(readPublicMainnet(controller.signal,async(_url,options)=>{expect(options?.signal?.aborted).toBe(true);throw new DOMException('Cancelled','AbortError');},()=>now)).rejects.toThrow('Cancelled');});
});
