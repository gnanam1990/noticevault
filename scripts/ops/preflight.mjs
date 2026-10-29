import {sharedSnapshot,verifySnapshot,SnapshotError} from './paired-snapshot.mjs';
// @ts-check
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPublicClient,http,keccak256,encodeDeployData,parseAbi} from 'viem';
/** @param {import('node:crypto').BinaryLike} b */
const hash=b=>createHash('sha256').update(b).digest('hex');
const addr=/^0x[0-9a-fA-F]{40}$/,digest=/^0x[0-9a-fA-F]{64}$/;
/** @param {unknown} ok @param {string} reason @returns {asserts ok} */
function requireValue(ok,reason){if(!ok)throw Error(reason);}
/** @typedef {import('viem').Address} Address */
/** @typedef {import('viem').Hex} Hex */
/** @typedef {{version:number,identity:string,chainId:number,token:Address,guardian:Address,signer:Address,tokenDecimals:number,nativeGasDecimals:number,tokenRuntimeKeccak:Hex,sourceHead:string,artifactSha256:string,artifactPath:string,guardianScope:string,signerReviewed:boolean,periodAmount:string,noticeReserve:string,agreementCap:string,factoryCap:string,reviewedMaxLiability:string,periodSeconds:string,noticeSeconds:string,rpcUrls:string[],deployedFactory?:{address:Address,runtimeKeccak:Hex}}} Plan */
/** @typedef {{number:bigint|null,hash:Hex|null,timestamp:bigint}} ChainBlock */
/** @typedef {{address:Address,abi:import('viem').Abi,functionName:string,args?:readonly unknown[],blockNumber:bigint,account?:Address}} ContractRead */
/** @typedef {{getChainId:()=>Promise<number>,getBlock:(options:{blockTag:'latest'}|{blockNumber:bigint})=>Promise<ChainBlock>,getCode:(options:{address:Address,blockNumber:bigint})=>Promise<Hex|undefined>,readContract:(options:ContractRead)=>Promise<unknown>,simulateContract:(options:ContractRead)=>Promise<{result:unknown}>,getBalance:(options:{address:Address,blockNumber:bigint})=>Promise<bigint>}} RpcClient */
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value){requireValue(typeof value==='object'&&value!==null&&!Array.isArray(value),'OBJECT_REQUIRED');return /** @type {Record<string,unknown>} */(value);}
/** @param {unknown} value @returns {string} */
function text(value){requireValue(typeof value==='string','STRING_REQUIRED');return value;}
/** @param {unknown} value @returns {number} */
function integer(value){requireValue(typeof value==='number'&&Number.isSafeInteger(value),'INTEGER_REQUIRED');return value;}
/** @param {unknown} value @returns {Address} */
function address(value){const v=text(value);requireValue(addr.test(v)&&!/^0x0{40}$/i.test(v),'ADDRESS_REQUIRED');return /** @type {Address} */(v);}
/** @param {unknown} value @returns {Hex} */
function hex(value){const v=text(value);requireValue(/^0x(?:[0-9a-fA-F]{2})+$/.test(v),'HEX_BYTES_REQUIRED');return /** @type {Hex} */(v);}
/** @param {unknown} value @returns {bigint} */
function unsigned(value){requireValue(typeof value==='bigint'&&value>=0n,'UNSIGNED_BIGINT_REQUIRED');return value;}
/** @param {unknown} value @returns {Plan} */
export function parsePlan(value){
 const p=record(value);requireValue(typeof p.signerReviewed==='boolean','BOOLEAN_REQUIRED');
 requireValue(Array.isArray(p.rpcUrls)&&p.rpcUrls.every(v=>typeof v==='string'),'RPC_URL_STRINGS_REQUIRED');
 /** @type {Plan} */
 const result={version:integer(p.version),identity:text(p.identity),chainId:integer(p.chainId),token:address(p.token),guardian:address(p.guardian),signer:address(p.signer),tokenDecimals:integer(p.tokenDecimals),nativeGasDecimals:integer(p.nativeGasDecimals),tokenRuntimeKeccak:hex(p.tokenRuntimeKeccak),sourceHead:text(p.sourceHead),artifactSha256:text(p.artifactSha256),artifactPath:text(p.artifactPath),guardianScope:text(p.guardianScope),signerReviewed:p.signerReviewed,periodAmount:text(p.periodAmount),noticeReserve:text(p.noticeReserve),agreementCap:text(p.agreementCap),factoryCap:text(p.factoryCap),reviewedMaxLiability:text(p.reviewedMaxLiability),periodSeconds:text(p.periodSeconds),noticeSeconds:text(p.noticeSeconds),rpcUrls:p.rpcUrls.map(text)};
 if(p.deployedFactory!==undefined&&p.deployedFactory!==null){const d=record(p.deployedFactory);result.deployedFactory={address:address(d.address),runtimeKeccak:hex(d.runtimeKeccak)};}
 return result;
}
/** @param {string} url @returns {RpcClient} */
function rpcClient(url){const c=createPublicClient({transport:http(url,{retryCount:0,timeout:5000,fetchOptions:{redirect:'error'}})});return {getChainId:()=>c.getChainId(),getBlock:o=>c.getBlock(o),getCode:o=>c.getCode(o),readContract:o=>c.readContract(o),simulateContract:async o=>({result:(await c.simulateContract({...o,account:o.account})).result}),getBalance:o=>c.getBalance(o)};}

const tokenAbi=parseAbi(['function decimals() view returns (uint8)','function totalSupply() view returns (uint256)','function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)','function approve(address,uint256) returns (bool)','function transfer(address,uint256) returns (bool)','function transferFrom(address,address,uint256) returns (bool)']);
/** @param {unknown} v */
function amount(v){requireValue(typeof v==='string'&&/^[1-9][0-9]{0,15}$/.test(v),'CAPS_REQUIRE_POSITIVE_MICRO_USDC_STRINGS');return BigInt(v);}
/** @param {unknown} value */
export function validatePlan(value){
 const p=parsePlan(value);
 requireValue(p.version===1&&((p.identity==='ARC_TESTNET'&&p.chainId===5042002)||(p.identity==='ARC_MAINNET'&&p.chainId===5042)),'EXACT_SUPPORTED_ARC_NETWORK_REQUIRED');
 for(const k of /** @type {const} */(['token','guardian','signer']))requireValue(addr.test(p[k])&&!/^0x0{40}$/i.test(p[k]),'EXACT_'+k.toUpperCase()+'_REQUIRED');
 requireValue(p.tokenDecimals===6&&p.nativeGasDecimals===18,'TOKEN_GAS_UNITS_MUST_BE_SEPARATE');
 requireValue(digest.test(p.tokenRuntimeKeccak)&&/^[0-9a-f]{40}$/.test(p.sourceHead)&&/^[0-9a-f]{64}$/.test(p.artifactSha256),'EXACT_ARTIFACT_SOURCE_TOKEN_PINS_REQUIRED');
 requireValue(p.guardianScope==='NEW_CREATION_ONLY'&&p.signerReviewed===true,'REVIEWED_SIGNER_AND_GUARDIAN_SCOPE_REQUIRED');
 const a=amount(p.periodAmount),r=amount(p.noticeReserve),agreement=amount(p.agreementCap),factory=amount(p.factoryCap),ceiling=amount(p.reviewedMaxLiability);
 const period=amount(p.periodSeconds),notice=amount(p.noticeSeconds);requireValue(period>=3600n&&notice>=3600n&&period<=2678400n&&notice<=7776000n&&r===(a*notice+period-1n)/period,'INVALID_TIME_OR_NOTICE_RESERVE');
 requireValue(ceiling<=1000000000000000n&&factory<=ceiling&&agreement<=factory&&a+r+a<=agreement,'CAPS_EXCEED_POLICY_OR_CANNOT_FUND_INITIAL_AND_ONE_RENEWAL');
 requireValue(Array.isArray(p.rpcUrls)&&p.rpcUrls.length===2&&p.rpcUrls[0]!==p.rpcUrls[1],'TWO_DISTINCT_REVIEWED_RPC_REQUIRED');
 for(const value of p.rpcUrls){const u=new URL(value);requireValue(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.origin===value,'PUBLIC_HTTPS_RPC_WITHOUT_CREDENTIALS_REQUIRED');}
 requireValue(new URL(p.rpcUrls[0]).hostname!==new URL(p.rpcUrls[1]).hostname,'INDEPENDENT_RPC_HOSTS_REQUIRED');
 return {factory,agreement};
}
/** @param {Plan} p @param {string} root */
export function inspectArtifacts(p,root=process.cwd()){
 const base=realpathSync(root),path=realpathSync(resolve(base,p.artifactPath));requireValue(path.startsWith(base+sep)&&statSync(path).size<4000000,'BOUNDED_LOCAL_ARTIFACT_REQUIRED');
 const bytes=readFileSync(path);requireValue(hash(bytes)===p.artifactSha256,'ARTIFACT_DIGEST_MISMATCH');const a=record(/** @type {unknown} */(JSON.parse(bytes.toString('utf8')))),m=record(a.metadata),compiler=record(m.compiler),settings=record(m.settings),optimizer=record(settings.optimizer),target=record(settings.compilationTarget),bytecode=record(a.bytecode),bytecodeHex=hex(bytecode.object);
 requireValue(compiler.version==='0.8.28+commit.7893614a'&&settings.evmVersion==='paris'&&optimizer.enabled===true&&optimizer.runs===200&&settings.viaIR===true,'COMPILER_SETTINGS_MISMATCH');
 requireValue(target['contracts/src/NoticeVaultFactory.sol']==='NoticeVaultFactory','WRONG_FACTORY_ARTIFACT');
 requireValue(/^0x[0-9a-fA-F]+$/.test(bytecodeHex)&&Object.keys(record(bytecode.linkReferences??{})).length===0,'UNLINKED_OR_EMPTY_BYTECODE');
 requireValue(Object.keys(record(m.sources??{})).length>0,'SOURCE_METADATA_MISSING');
 for(const [name,source] of Object.entries(record(m.sources))){const file=realpathSync(resolve(base,name));requireValue(file.startsWith(base+sep)&&statSync(file).size<2000000&&keccak256(readFileSync(file))===text(record(source).keccak256),'COMPILED_SOURCE_MISMATCH');}
 const head=execFileSync('git',['rev-parse','HEAD'],{cwd:base,encoding:'utf8'}).trim();requireValue(head===p.sourceHead,'SOURCE_HEAD_MISMATCH');
 const dirty=execFileSync('git',['status','--porcelain','--untracked-files=normal'],{cwd:base,encoding:'utf8'}).trim();requireValue(!dirty,'CLEAN_REVIEWED_CANDIDATE_REQUIRED');
 const abiEntries=a.abi;requireValue(Array.isArray(abiEntries),'ABI_REQUIRED');const constructors=abiEntries.map(record).filter(entry=>entry.type==='constructor');requireValue(constructors.length===1,'EXACT_CONSTRUCTOR_ABI_REQUIRED');const inputs=constructors[0].inputs;requireValue(Array.isArray(inputs)&&inputs.map(input=>text(record(input).type)).join(',')==='address,address,uint256,uint256'&&constructors[0].stateMutability==='nonpayable','EXACT_CONSTRUCTOR_ABI_REQUIRED');
 return {artifact:{...a,abi:parseAbi(['constructor(address guardian,address token,uint256 factoryCap,uint256 agreementCap)']),bytecode:{...bytecode,object:bytecodeHex}},artifactSha256:hash(bytes),sourceHead:head,compiler:compiler.version,settings,toolchain:{runtime:process.version,bun:process.versions.bun??null,foundryConfigSha256:hash(readFileSync(resolve(base,'foundry.toml'))),lockfileSha256:hash(readFileSync(resolve(base,'bun.lock')))}};
}
/** @param {unknown} v */
const normal=v=>JSON.stringify(v,/** @param {string} _ @param {unknown} x */(_,x)=>typeof x==='bigint'?x.toString():x);
/** @template T @param {Promise<T>} work @returns {Promise<T>} */
async function bounded(work){/** @type {ReturnType<typeof setTimeout>|undefined} */let timer;try{return await Promise.race([work,new Promise(/** @param {(value:T)=>void} _ */(_,reject)=>{timer=setTimeout(()=>reject(Error('RPC_TIMEOUT')),5000);})]);}finally{clearTimeout(timer);}}
/** @param {Plan} p @param {RpcClient[]} clients @param {number} now */
export async function inspectChain(p,clients,now=Date.now()){
 requireValue(clients.length===2,'PAIRED_RPC_REQUIRED');
 /** @template T @param {(client:RpcClient)=>Promise<T>} fn @returns {Promise<T>} */
 async function paired(fn){const [a,b]=await bounded(Promise.all(clients.map(fn)));requireValue(normal(a)===normal(b),'RPC_DISAGREEMENT');return a;}
 requireValue(await paired(c=>c.getChainId())===p.chainId,'WRONG_RPC_CHAIN');
 const started=performance.now(),clock=()=>now+Math.floor(performance.now()-started);
 const block=await sharedSnapshot(clients,clock);
 const blockNumber=block.number,blockHash=block.hash;requireValue(typeof blockNumber==='bigint'&&blockNumber>=0n&&blockHash!==null&&digest.test(blockHash)&&Number(block.timestamp)*1000<=now+30000&&now-Number(block.timestamp)*1000<120000,'STALE_OR_INVALID_BLOCK');
 const code=await paired(c=>c.getCode({address:p.token,blockNumber:blockNumber}));requireValue(code&&code!=='0x'&&keccak256(code).toLowerCase()===p.tokenRuntimeKeccak.toLowerCase(),'TOKEN_RUNTIME_MISMATCH');
 /** @param {string} name @param {readonly unknown[]} args */
 const read=(name,args=[])=>paired(c=>c.readContract({address:p.token,abi:tokenAbi,functionName:name,args,blockNumber:blockNumber}));
 requireValue(await read('decimals')===6,'TOKEN_DECIMALS_MISMATCH');
 for(const value of [await read('totalSupply'),await read('balanceOf',[p.signer]),await read('allowance',[p.signer,p.guardian])])requireValue(typeof value==='bigint'&&value>=0n,'INVALID_ERC20_READ_INTERFACE');
 // eth_call simulations only. Never request a wallet, signature, gas estimate or broadcast.
 for(const [name,args] of /** @type {[string,readonly unknown[]][]} */([['approve',[p.guardian,0n]],['transfer',[p.signer,0n]],['transferFrom',[p.signer,p.signer,0n]]])){
  const result=await paired(async c=>(await c.simulateContract({address:p.token,abi:tokenAbi,functionName:name,args,account:p.signer,blockNumber:blockNumber})).result);requireValue(result===true,'TOKEN_ZERO_VALUE_SIMULATION_FAILED');
 }
 const gasBalance=await paired(c=>c.getBalance({address:p.signer,blockNumber:blockNumber}));requireValue(gasBalance>0n,'SIGNER_HAS_NO_NATIVE_GAS');
 const deployed=p.deployedFactory?await inspectDeployedFactory(p,clients,{number:blockNumber,hash:blockHash}):null;
 await verifySnapshot(clients,block,clock);
 return {deployed,block:{...block,number:blockNumber,hash:blockHash},tokenRuntimeKeccak:keccak256(code),tokenDecimals:6,nativeGasDecimals:18,signerGasBalance:gasBalance,zeroValueEthCallChecks:'PASS'};
}
/** @param {{bytes:Uint8Array,reviewSha256?:string,root?:string,clients?:RpcClient[],now?:number}} options */
export async function preflight({bytes,reviewSha256,root,clients,now}){
 requireValue(/^[0-9a-f]{64}$/.test(reviewSha256??'')&&bytes.length<32768&&hash(bytes)===reviewSha256,'INDEPENDENT_REVIEWED_PLAN_DIGEST_REQUIRED');
 const p=parsePlan(/** @type {unknown} */(JSON.parse(new TextDecoder().decode(bytes))));const caps=validatePlan(p),local=inspectArtifacts(p,root);
 const rpc=clients??p.rpcUrls.map(rpcClient);
 const chain=await inspectChain(p,rpc,now);
 const initCode=encodeDeployData({abi:local.artifact.abi,bytecode:local.artifact.bytecode.object,args:[p.guardian,p.token,caps.factory,caps.agreement]});
 return {status:'READ_ONLY_CHECKS_PASSED_DEPLOYMENT_BLOCKED',blockers:['SEPARATE_DEPLOYMENT_AUTHORITY_AND_SIGNER_CONTROL_REQUIRED'],deploymentAuthorized:false,signerControlVerified:false,reviewSha256,sourceHead:local.sourceHead,artifactSha256:local.artifactSha256,compiler:local.compiler,compilerSettings:local.settings,toolchain:local.toolchain,chainId:p.chainId,guardianScope:p.guardianScope,constructorArgs:[p.guardian,p.token,p.factoryCap,p.agreementCap],initCodeKeccak:keccak256(initCode),chain,warning:'Cap exhaustion can block renewal and trigger notice. This check proves neither signer control nor nonzero token transfer behavior. Separate deployment authority and live acceptance are required.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const [file,pin]=process.argv.slice(2);if(file==='--help'){console.log('bun scripts/ops/preflight.mjs PLAN.json INDEPENDENT_REVIEW_SHA256. Read-only explicit Arc mainnet/testnet check; no signer or broadcaster.');}else{requireValue(file&&statSync(file).size<32768,'BOUNDED_REVIEWED_PLAN_REQUIRED');console.log(normal(await preflight({bytes:readFileSync(file),reviewSha256:pin})));}}
 catch(e){console.error(JSON.stringify({status:'BLOCKED',reason:e instanceof Error&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'PREFLIGHT_FAILED',deploymentAuthorized:false,...(e instanceof SnapshotError?{diagnostic:e.diagnostic}:{})}));process.exitCode=1;}
}

// Optional deployed identity comes only from the independently pinned plan; still read-only.
/** @param {Plan} p @param {RpcClient[]} clients @param {{number:bigint,hash:Hex}} block */
export async function inspectDeployedFactory(p,clients,block){
 const d=p.deployedFactory;requireValue(d,'EXACT_DEPLOYED_FACTORY_PIN_REQUIRED');requireValue(addr.test(d?.address)&&digest.test(d?.runtimeKeccak),'EXACT_DEPLOYED_FACTORY_PIN_REQUIRED');
 const abi=parseAbi(['function guardian() view returns(address)','function allowlistedToken() view returns(address)','function factoryCap() view returns(uint256)','function agreementCap() view returns(uint256)','function outstandingLiability() view returns(uint256)','function creationPaused() view returns(bool)']);
 /** @template T @param {(client:RpcClient)=>Promise<T>} fn @returns {Promise<T>} */
 async function paired(fn){const [a,b]=await bounded(Promise.all(clients.map(fn)));requireValue(normal(a)===normal(b),'RPC_DISAGREEMENT');return a;}
 const code=await paired(c=>c.getCode({address:d.address,blockNumber:block.number}));requireValue(code&&keccak256(code)===d.runtimeKeccak,'DEPLOYED_FACTORY_CODE_MISMATCH');
 /** @param {string} fn */
 const read=fn=>paired(c=>c.readContract({address:d.address,abi,functionName:fn,blockNumber:block.number}));
 requireValue(text(await read('guardian')).toLowerCase()===p.guardian.toLowerCase()&&text(await read('allowlistedToken')).toLowerCase()===p.token.toLowerCase(),'DEPLOYED_CONSTRUCTOR_MISMATCH');
 const cap=unsigned(await read('factoryCap')),agreement=unsigned(await read('agreementCap')),liability=unsigned(await read('outstandingLiability')),paused=await read('creationPaused');requireValue(typeof paused==='boolean','DEPLOYED_PAUSE_STATE_INVALID');
 requireValue(cap===BigInt(p.factoryCap)&&agreement===BigInt(p.agreementCap)&&liability>=0n&&liability<=cap,'DEPLOYED_CAP_MISMATCH');
 const headroom=cap-liability,alerts=[];if(headroom<BigInt(p.periodAmount))alerts.push('FACTORY_CAP_BLOCKS_ONE_RENEWAL');else if(headroom*10n<cap)alerts.push('FACTORY_CAP_HEADROOM_LOW');if(paused)alerts.push('NEW_CREATION_PAUSED_EXISTING_RIGHTS_UNCHANGED');
 requireValue(await paired(async c=>(await c.getBlock({blockNumber:block.number})).hash)===block.hash,'BLOCK_REORG');
 return {factoryCap:cap,agreementCap:agreement,outstandingLiability:liability,headroom,creationPaused:paused,alerts,observedAtBlock:block.number};
}
