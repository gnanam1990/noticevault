import {decodeEventLog,keccak256,toFunctionSelector} from 'viem';
import {FACTORY_EVENTS} from './factory-events.js';
import {decodeLifecycleBlock} from './decode.js';
export interface Rpc {request(method:string,params:unknown[],signal?:AbortSignal):Promise<unknown>;}
type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid RPC object');return v as Obj;};
const hex=(v:unknown,n:number):string=>{if(typeof v!=='string'||!new RegExp('^0x[0-9a-fA-F]{'+n+'}$').test(v))throw new Error('Invalid RPC hex');return v.toLowerCase();};
const qty=(v:unknown):bigint=>{if(typeof v!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(v))throw new Error('Invalid RPC quantity');return BigInt(v);};
const decimal=(v:unknown):string=>{if(typeof v!=='string'||!/^(0|[1-9][0-9]*)$/.test(v))throw new Error('Invalid decimal');return v;};
const bytes=(v:unknown):`0x${string}`=>{if(typeof v!=='string'||!/^0x(?:[0-9a-fA-F]{2})*$/.test(v))throw new Error('Invalid RPC bytes');return v.toLowerCase() as `0x${string}`;};
const bound=(v:unknown,max:number):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1||v>max)throw new Error('Invalid transport limit');return v;};
export function validateRpcPolicy(value:unknown){
 const p=obj(value);const allowed=['mode','chainId','factory','token','tokenDecimals','factoryCodeHash','tokenCodeHash','maxTransactions','maxLogs','addressPageSize','maxRequests','requestTimeoutMs'];if(Object.keys(p).some(k=>!allowed.includes(k)))throw new Error('Unknown RPC policy field');if(p.mode!=='SYNTHETIC'&&p.mode!=='RPC_OBSERVED')throw new Error('LIVE_TRANSPORT_NOT_ENABLED');
 const chainId=decimal(p.chainId);if(BigInt(chainId)<=0n)throw new Error('Chain ID required');
 const factory=hex(p.factory,40),token=hex(p.token,40);if(BigInt(factory)===0n||BigInt(token)===0n||factory===token)throw new Error('Invalid deployment addresses');
 if(p.tokenDecimals!==6)throw new Error('Decimals policy must match NoticeVault USDC');
 return Object.freeze({mode:p.mode as 'SYNTHETIC'|'RPC_OBSERVED',chainId,factory,token,tokenDecimals:6,factoryCodeHash:hex(p.factoryCodeHash,64),tokenCodeHash:hex(p.tokenCodeHash,64),maxTransactions:bound(p.maxTransactions,10000),maxLogs:bound(p.maxLogs,100000),addressPageSize:bound(p.addressPageSize,1000),maxRequests:bound(p.maxRequests,100000),requestTimeoutMs:bound(p.requestTimeoutMs,60000)});
}
export function createRpcTransport(value:unknown,rpc:Rpc,knownAgreements:()=>Promise<string[]>,signal?:AbortSignal){
 const p=validateRpcPolicy(value);
 return {async readBlock(number:string){
  const requested=decimal(number),tag='0x'+BigInt(requested).toString(16);let requests=0;
  const cancelled=()=>{if(signal?.aborted)throw new Error('RPC_CANCELLED');};
  const request=async(method:string,params:unknown[])=>{cancelled();if(++requests>p.maxRequests)throw new Error('RPC request budget exceeded');let timer:ReturnType<typeof setTimeout>|undefined;let abort:()=>void=()=>{};try{const stop=new Promise<never>((_,reject)=>{abort=()=>reject(new Error('RPC_CANCELLED'));signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>reject(new Error('RPC_TIMEOUT')),p.requestTimeoutMs);});const result=await Promise.race([rpc.request(method,params,signal),stop]);cancelled();return result;}finally{if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);}};
  if(qty(await request('eth_chainId',[])).toString()!==p.chainId)throw new Error('Chain mismatch');
  const first=await request('eth_getBlockByNumber',[tag,false]);if(first===null)return null;
  const h=obj(first),hash=hex(h.hash,64),parentHash=hex(h.parentHash,64),timestamp=qty(h.timestamp);
  if(qty(h.number).toString()!==requested||timestamp>=(1n<<64n))throw new Error('Canonical block number/time mismatch');
  if(!Array.isArray(h.transactions)||h.transactions.length>p.maxTransactions)throw new Error('Transaction count exceeds limit');
  const transactions=h.transactions.map(t=>hex(t,64));if(new Set(transactions).size!==transactions.length)throw new Error('Transaction identity duplicate');
  const pin={blockHash:hash,requireCanonical:true};
  for(const [address,expected] of [[p.factory,p.factoryCodeHash],[p.token,p.tokenCodeHash]]){const code=bytes(await request('eth_getCode',[address,pin]));if(code==='0x'||keccak256(code)!==expected)throw new Error('Code fingerprint mismatch');}
  const call=async(to:string,signature:string)=>bytes(await request('eth_call',[{to,data:toFunctionSelector(signature)},pin]));
  const tokenResult=await call(p.factory,'allowlistedToken()');if(tokenResult!==('0x'+p.token.slice(2).padStart(64,'0')))throw new Error('Token binding mismatch');
  const decimalsResult=await call(p.token,'decimals()');if(decimalsResult!==('0x'+p.tokenDecimals.toString(16).padStart(64,'0')))throw new Error('Decimals mismatch');
  const normalizeLog=(value:unknown)=>{const l=obj(value),index=qty(l.transactionIndex),logIndex=qty(l.logIndex);if(index>=BigInt(transactions.length)||logIndex>=BigInt(p.maxLogs)||l.removed!==false||hex(l.blockHash,64)!==hash||qty(l.blockNumber).toString()!==requested||hex(l.transactionHash,64)!==transactions[Number(index)])throw new Error('Log identity mismatch');if(!Array.isArray(l.topics)||l.topics.length>4)throw new Error('Invalid log topics');return {address:hex(l.address,40),blockNumber:tag,blockHash:hash,transactionHash:transactions[Number(index)]!,transactionIndex:'0x'+index.toString(16),logIndex:'0x'+logIndex.toString(16),removed:false,topics:l.topics.map(t=>hex(t,64)),data:bytes(l.data)};};
  const logs:ReturnType<typeof normalizeLog>[]=[];
  for(let i=0;i<transactions.length;i++){const receipt=await request('eth_getTransactionReceipt',[transactions[i]]);if(receipt===null)throw new Error('Receipt missing');const r=obj(receipt);if(hex(r.transactionHash,64)!==transactions[i]||qty(r.transactionIndex)!==BigInt(i)||hex(r.blockHash,64)!==hash||qty(r.blockNumber).toString()!==requested||!Array.isArray(r.logs)||(r.status!=='0x0'&&r.status!=='0x1')||(r.status==='0x0'&&r.logs.length!==0))throw new Error('Receipt identity/status mismatch');if(logs.length+r.logs.length>p.maxLogs)throw new Error('Log budget exceeded');for(const raw of r.logs){const l=normalizeLog(raw);if(qty(l.transactionIndex)!==BigInt(i)||qty(l.logIndex)!==BigInt(logs.length))throw new Error('Log order/gap/duplicate');logs.push(l);}}
  cancelled();const registered=await knownAgreements();cancelled();if(!Array.isArray(registered)||registered.length>10000)throw new Error('Agreement registry limit');const addresses=new Set([p.factory,...registered.map(a=>hex(a,40))]);const creation=new Set<string>();
  for(const log of logs.filter(l=>l.address===p.factory)){const decoded=decodeEventLog({abi:FACTORY_EVENTS,topics:log.topics as [`0x${string}`],data:log.data,strict:true});const event=FACTORY_EVENTS.find(e=>e.name===decoded.eventName)!;if(log.topics.length!==1+event.inputs.filter(i=>i.indexed).length||log.data.length!==2+64*event.inputs.filter(i=>!i.indexed).length)throw new Error('Factory event encoding mismatch');if(decoded.eventName==='AgreementCreated'){if(!decoded.args)throw new Error('Missing creation arguments');addresses.add(decoded.args.agreement.toLowerCase());creation.add(log.logIndex);}}
  const expected=logs.filter(l=>addresses.has(l.address)),observed:ReturnType<typeof normalizeLog>[]=[];
  const page=async(group:string[]):Promise<void>=>{try{const response=await request('eth_getLogs',[{blockHash:hash,address:group}]);if(!Array.isArray(response)||observed.length+response.length>p.maxLogs)throw new Error('Log response limit');for(const raw of response){const l=normalizeLog(raw);if(!group.includes(l.address))throw new Error('Log address outside requested page');observed.push(l);}}catch(error){if((error as {code?:unknown})?.code!==-32005||group.length<=1)throw error;const middle=Math.floor(group.length/2);await page(group.slice(0,middle));await page(group.slice(middle));}};
  const list=[...addresses];for(let i=0;i<list.length;i+=p.addressPageSize)await page(list.slice(i,i+p.addressPageSize));
  observed.sort((a,b)=>Number(qty(a.logIndex)-qty(b.logIndex)));if(JSON.stringify(observed)!==JSON.stringify(expected))throw new Error('Log set mismatch: incomplete, duplicate or contradictory');
  const last=obj(await request('eth_getBlockByNumber',[tag,false]));if(hex(last.hash,64)!==hash||hex(last.parentHash,64)!==parentHash||qty(last.number).toString()!==requested||qty(last.timestamp)!==timestamp||!Array.isArray(last.transactions)||JSON.stringify(last.transactions.map(t=>hex(t,64)))!==JSON.stringify(transactions))throw new Error('Canonical block changed');
  if(qty(await request('eth_chainId',[])).toString()!==p.chainId)throw new Error('Chain changed');cancelled();
  return decodeLifecycleBlock({source:p.mode,chainId:p.chainId,factory:p.factory},{chainId:p.chainId,factory:p.factory,number:requested,hash,parentHash,timestamp:timestamp.toString(),logs:expected.filter(l=>l.address!==p.factory||creation.has(l.logIndex))});
 }};
}
