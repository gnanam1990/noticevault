import test from 'node:test';
import {keccak256} from 'viem';
import assert from 'node:assert/strict';
import {validatePlan,parsePlan,inspectChain,inspectDeployedFactory} from './preflight.mjs';
const address='0x1111111111111111111111111111111111111111';
const hash='0x2222222222222222222222222222222222222222222222222222222222222222';
const input={version:1,identity:'ARC_MAINNET',chainId:5042,token:address,guardian:address,signer:address,tokenDecimals:6,nativeGasDecimals:18,tokenRuntimeKeccak:hash,sourceHead:'a'.repeat(40),artifactSha256:'b'.repeat(64),artifactPath:'fixture.json',guardianScope:'NEW_CREATION_ONLY',signerReviewed:true,periodAmount:'3000000',noticeReserve:'3000000',periodSeconds:'3600',noticeSeconds:'3600',agreementCap:'9000000',factoryCap:'90000000',reviewedMaxLiability:'90000000',rpcUrls:['https://primary.invalid','https://secondary.invalid']};
await test('plan parser rejects structural/coercion errors without accepting truthy substitutes',()=>{
 for(const value of [null,[],1,'plan',{}, {...input,token:{toString:()=>address}}, {...input,chainId:'5042'}, {...input,signerReviewed:1}, {...input,periodAmount:3000000}, {...input,rpcUrls:['https://primary.invalid',1]}, {...input,deployedFactory:false}])assert.throws(()=>validatePlan(value));
 assert.doesNotThrow(()=>validatePlan(input));assert.doesNotThrow(()=>validatePlan({...input,identity:'ARC_TESTNET',chainId:5042002}));
 assert.deepEqual(input.rpcUrls,['https://primary.invalid','https://secondary.invalid']);
});
await test('reviewed public plan rejects key paths, query credentials, same-host providers and wrong network',()=>{
 for(const rpcUrls of [['https://primary.invalid/v2/DUMMY_KEY','https://secondary.invalid'],['https://primary.invalid?key=DUMMY','https://secondary.invalid'],['https://primary.invalid','https://primary.invalid:444'],['https://primary.invalid/','https://secondary.invalid']])assert.throws(()=>validatePlan({...input,rpcUrls}));
 assert.throws(()=>validatePlan({...input,chainId:5042002}));
});
await test('canonical inspection rejects null/negative blocks and malformed deployed accounting',async()=>{
 const plan=parsePlan(input),now=Date.now();
 /** @returns {import('./preflight.mjs').RpcClient} */
 const client=()=>({getChainId:()=>Promise.resolve(5042),getBlock:()=>Promise.resolve({number:12n,hash,timestamp:BigInt(Math.floor(now/1000))}),getCode:()=>Promise.resolve('0x6000'),readContract:()=>Promise.resolve(6),simulateContract:()=>Promise.resolve({result:true}),getBalance:()=>Promise.resolve(1n)});
 for(const number of [null,-1n]){const a=client();a.getBlock=()=>Promise.resolve({number,hash,timestamp:BigInt(Math.floor(now/1000))});await assert.rejects(inspectChain(plan,[a,a],now),/STALE_OR_INVALID_BLOCK/);}
 const deployed=parsePlan({...plan,deployedFactory:{address,runtimeKeccak:keccak256('0x6000')}});
 for(const changed of [{factoryCap:'90000000'},{outstandingLiability:-1n},{creationPaused:'false'}]){
  /** @type {Record<string,unknown>} */
  const values={guardian:address,allowlistedToken:address,factoryCap:90000000n,agreementCap:9000000n,outstandingLiability:0n,creationPaused:false,...changed};
  const a=client();a.readContract=o=>Promise.resolve(values[o.functionName]);
  await assert.rejects(inspectDeployedFactory(deployed,[a,a],{number:12n,hash}),/UNSIGNED_BIGINT_REQUIRED|DEPLOYED_PAUSE_STATE_INVALID/);
 }
});

await test('deployment preparation matches Solidity period and notice boundaries',()=>{
  for(const [periodSeconds,noticeSeconds] of [['3600','3600'],['2678400','7776000']]){
    const a=10000n,p=BigInt(periodSeconds),n=BigInt(noticeSeconds);
    assert.doesNotThrow(()=>validatePlan({...input,periodAmount:String(a),noticeReserve:String((a*n+p-1n)/p),periodSeconds,noticeSeconds}));
  }
  for(const [periodSeconds,noticeSeconds] of [['3599','3600'],['2678401','3600'],['3600','3599'],['3600','7776001']]){
    const a=10000n,p=BigInt(periodSeconds),n=BigInt(noticeSeconds);
    assert.throws(()=>validatePlan({...input,periodAmount:String(a),noticeReserve:String((a*n+p-1n)/p),periodSeconds,noticeSeconds}),/INVALID_TIME_OR_NOTICE_RESERVE/);
  }
});
