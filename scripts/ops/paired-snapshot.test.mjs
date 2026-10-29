import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedSnapshot,verifySnapshot,SnapshotError} from './paired-snapshot.mjs';
const now=1700000000000,clock=()=>now;
const hash='0x'+'a'.repeat(64),other='0x'+'b'.repeat(64);
/** @param {bigint} number @param {bigint} timestamp @param {string} value */
const h=(number=100n,timestamp=1700000000n,value=hash)=>({number,timestamp,hash:/** @type {import('viem').Hex} */(value)});
/** @param {(query:{blockTag:'latest'}|{blockNumber:bigint})=>Promise<import('./preflight.mjs').ChainBlock>} getBlock @returns {import('./preflight.mjs').RpcClient} */
const client=getBlock=>({getBlock,getChainId:()=>Promise.resolve(5042),getCode:()=>Promise.resolve(undefined),readContract:()=>Promise.resolve(0n),simulateContract:()=>Promise.resolve({result:true}),getBalance:()=>Promise.resolve(1n)});
/** @param {ReturnType<typeof h>} head @param {ReturnType<typeof h>} fixed */
const c=(head=h(),fixed=h())=>client(q=>Promise.resolve('blockTag' in q?head:fixed));
await test('advancing asynchronous heads agree at explicit lower height and never latest state',async()=>{
 /** @type {({blockTag:'latest'}|{blockNumber:bigint})[]} */const queries=[];
 const a=client(q=>{queries.push(q);return Promise.resolve(h());});
 const b=client(q=>{queries.push(q);return Promise.resolve('blockTag' in q?h(102n,1700000001n):h());});
 const block=await sharedSnapshot([a,b],clock);assert.equal(block.number,100n);
 assert.deepEqual(queries.slice(2),[{blockNumber:100n},{blockNumber:100n}]);
 await verifySnapshot([a,b],block,clock);
});
await test('head lag, time skew and nonmonotonic head timestamps fail closed',async()=>{
 for(const head of [h(109n),h(101n,1700000016n),h(101n,1699999999n)])await assert.rejects(sharedSnapshot([c(),c(head)],clock),/RPC_HEAD_LAG|RPC_DISAGREEMENT/);
});
await test('same-height forks and timestamp mismatches cannot be hidden by lower selection',async()=>{
 for(const head of [h(100n,1700000000n,other),h(100n,1700000001n)])await assert.rejects(sharedSnapshot([c(),c(head)],clock),/RPC_DISAGREEMENT/);
});
await test('shared height rejects wrong number, hash, timestamp or sampled-head reorg',async()=>{
 for(const fixed of [h(99n),h(100n,1700000000n,other),h(100n,1699999999n)])await assert.rejects(sharedSnapshot([c(),c(h(101n),fixed)],clock),/RPC_DISAGREEMENT/);
 await assert.rejects(sharedSnapshot([c(h(),h(100n,1700000000n,other)),c(h(),h(100n,1700000000n,other))],clock),/RPC_DISAGREEMENT/);
});
await test('stale/future/invalid/unavailable block data never produces a snapshot',async()=>{
 for(const value of [h(100n,1699999880n),h(100n,1700000031n),{...h(),number:null},{...h(),timestamp:-1n}]){
  const bad=client(()=>Promise.resolve(value));await assert.rejects(sharedSnapshot([c(),bad],clock),/STALE_OR_INVALID_BLOCK/);
 }
 const bad=client(()=>Promise.reject(Error('https://secret.invalid/v2/DO_NOT_LOG')));
 await assert.rejects(sharedSnapshot([c(),bad],clock),e=>{assert.ok(e instanceof SnapshotError);assert.equal(e.message,'RPC_BLOCK_UNAVAILABLE');assert.ok(!JSON.stringify(e).includes('DO_NOT_LOG'));return true;});
});
await test('final verification rejects one/two-provider reorg and regression',async()=>{
 const block=await sharedSnapshot([c(),c()],clock);
 for(const pair of [[c(),c(h(),h(100n,1700000000n,other))],[c(h(),h(100n,1700000000n,other)),c(h(),h(100n,1700000000n,other))],[c(h(99n)),c(h(99n))]])await assert.rejects(verifySnapshot(pair,block,clock),/BLOCK_REORG|SNAPSHOT_ADVANCED_OR_REGRESSED/);
});
await test('elapsed freshness is checked after reads and diagnostics contain only public headers',async()=>{
 const block=await sharedSnapshot([c(),c()],clock);
 await assert.rejects(verifySnapshot([c(),c()],block,()=>now+120000),/STALE_OR_INVALID_BLOCK/);
 await assert.rejects(sharedSnapshot([c(),c(h(100n,1700000000n,other))],clock),e=>{assert.ok(e instanceof SnapshotError);assert.equal(e.diagnostic.stage,'heads');assert.equal(e.diagnostic.headers.length,2);assert.deepEqual(Object.keys(e.diagnostic.headers[0]),['provider','number','hash','timestamp']);return true;});
});

await test('healthy common head advancement preserves a fresh canonical snapshot',async()=>{const block=await sharedSnapshot([c(),c()],clock);await verifySnapshot([c(h(120n,1700000020n)),c(h(120n,1700000020n))],block,()=>now+20000);});

await test('inspectChain pins every state read and final reorg check to common height',async()=>{
 const {inspectChain,parsePlan}=await import('./preflight.mjs');
 const {keccak256}=await import('viem');
 const address='0x1111111111111111111111111111111111111111';
 const plan=parsePlan({version:1,identity:'ARC_MAINNET',chainId:5042,token:address,guardian:address,signer:address,tokenDecimals:6,nativeGasDecimals:18,tokenRuntimeKeccak:keccak256('0x6000'),sourceHead:'a'.repeat(40),artifactSha256:'b'.repeat(64),artifactPath:'fixture.json',guardianScope:'NEW_CREATION_ONLY',signerReviewed:true,periodAmount:'3000000',noticeReserve:'3000000',periodSeconds:'3600',noticeSeconds:'3600',agreementCap:'9000000',factoryCap:'90000000',reviewedMaxLiability:'90000000',rpcUrls:['https://primary.invalid','https://secondary.invalid']});
 /** @type {bigint[]} */const blocks=[];
 /** @param {bigint} head @returns {import('./preflight.mjs').RpcClient} */
 const provider=head=>({...c(h(head)),getCode:o=>{blocks.push(o.blockNumber);return Promise.resolve('0x6000');},readContract:o=>{blocks.push(o.blockNumber);return Promise.resolve(o.functionName==='decimals'?6:0n);},simulateContract:o=>{blocks.push(o.blockNumber);return Promise.resolve({result:true});},getBalance:o=>{blocks.push(o.blockNumber);return Promise.resolve(1n);}});
 const a=provider(100n),b=provider(101n);
 const result=await inspectChain(plan,[a,b],now);assert.equal(result.block.number,100n);assert.equal(blocks.length,18);assert.ok(blocks.every(n=>n===100n));
 const disagree={...b,getBalance:()=>Promise.resolve(2n)};
 await assert.rejects(inspectChain(plan,[a,disagree],now),/RPC_DISAGREEMENT/);
 let changed=false;
 /** @type {import('./preflight.mjs').RpcClient} */
 const reorg={...b,getBalance:o=>{changed=true;return b.getBalance(o);},getBlock:q=>Promise.resolve('blockTag' in q?h(101n):h(100n,1700000000n,changed?other:hash))};
 await assert.rejects(inspectChain(plan,[a,reorg],now),/BLOCK_REORG/);
});
