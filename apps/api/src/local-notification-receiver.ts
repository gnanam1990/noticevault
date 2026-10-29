// Local sink only: Unix socket transport has no network host, SMTP or forwarding path.
import {createServer,request} from 'node:http';
import {mkdtemp,lstat,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {createHash} from 'node:crypto';
import type {DeliveryAdapter,DeliveryResult} from './notification-delivery.js';
const uuid=/^[0-9a-f-]{36}$/i;
type Input={key:string;destination:string;payload:unknown};
export async function startControlledLocalReceiver(){
 const directory=await mkdtemp(join(tmpdir(),'noticevault-local-sink-'));await chmod(directory,0o700);const socketPath=join(directory,'receiver.sock');
 const records=new Map<string,{digest:string;receipt:string;payload:unknown;state:'accepted'|'delivered'}>();
 let mode:'accept'|'reject'|'timeout'|'disconnect'='accept';
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');const respond=(status:number,data:unknown)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  const key=req.url?.split('/')[2];if(!key||!uuid.test(key)||req.url!=='/receipts/'+key)return respond(404,{error:'LOCAL_ROUTE'});
  if(req.method==='GET'){const item=records.get(key);return respond(200,item?{state:item.state,receipt:item.receipt}:null);}
  if(req.method!=='POST')return respond(405,{error:'METHOD'});
  try{const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536)return respond(413,{state:'failed',retryable:false});chunks.push(Buffer.from(chunk));}
   const input=JSON.parse(Buffer.concat(chunks).toString('utf8')) as Input;
   if(input.key!==key||typeof input.destination!=='string'||input.destination.length>254||Object.keys(input).sort().join()!=='destination,key,payload')return respond(400,{state:'failed',retryable:false});
   const digest=createHash('sha256').update(JSON.stringify(input)).digest('hex'),prior=records.get(key);
   if(prior){if(prior.digest!==digest)return respond(409,{state:'failed',retryable:false});return respond(200,{state:prior.state,receipt:prior.receipt});}
   if(mode==='reject')return respond(422,{state:'failed',retryable:false});
   if(records.size>=1000)return respond(429,{state:'failed',retryable:true});
   const receipt='LOCAL_SINK_ONLY:'+key;records.set(key,{digest,receipt,payload:input.payload,state:'accepted'});
   if(mode==='disconnect'){req.socket.destroy();return;}if(mode==='timeout')return;
   return respond(202,{state:'accepted',receipt});
  }catch{if(!res.destroyed)respond(400,{state:'failed',retryable:false});}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o600);
 return {socketPath,setMode(next:typeof mode){mode=next;},inspect(key:string){return records.get(key);},acknowledgeLocalReceipt(key:string){const record=records.get(key);if(!record)throw Error('LOCAL_RECEIPT_MISSING');record.state='delivered';},async close(){server.closeAllConnections();if(server.listening)await new Promise<void>((resolve,reject)=>server.close(e=>e&&('code' in e&&e.code!=='ERR_SERVER_NOT_RUNNING')?reject(e):resolve()));await rm(directory,{recursive:true});}};
}
export async function createLocalNotificationAdapter(socketPath:string,timeoutMs=1000):Promise<DeliveryAdapter>{
 if(!socketPath.startsWith('/')||!Number.isSafeInteger(timeoutMs)||timeoutMs<20||timeoutMs>10000)throw Error('LOCAL_SINK_CONFIG');
 const parent=await lstat(dirname(socketPath)),socket=await lstat(socketPath);
 if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o077)!==0||!socket.isSocket()||socket.uid!==process.getuid?.())throw Error('PRIVATE_LOCAL_SOCKET_REQUIRED');
 async function call(key:string,input:Input|undefined,signal:AbortSignal):Promise<DeliveryResult|null>{
  if(!uuid.test(key)||signal.aborted)throw Error('LOCAL_DELIVERY_UNKNOWN');
  return new Promise((resolve,reject)=>{
   const body=input?JSON.stringify(input):undefined;if(body&&Buffer.byteLength(body)>65536){reject(Error('LOCAL_PAYLOAD_LIMIT'));return;}
   const req=request({socketPath,path:'/receipts/'+key,method:body?'POST':'GET',headers:{'Content-Type':'application/json'},signal},res=>{
    const chunks:Buffer[]=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>4096)req.destroy(Error('LOCAL_RESPONSE_LIMIT'));else chunks.push(chunk);});
    res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8')) as DeliveryResult|null;
     if(value!==null&&(!['accepted','delivered','failed'].includes(value.state)||(value.state!=='failed'&&value.receipt!=='LOCAL_SINK_ONLY:'+key)))throw Error();resolve(value);
    }catch{reject(Error('LOCAL_DELIVERY_UNKNOWN'));}});res.on('error',()=>reject(Error('LOCAL_DELIVERY_UNKNOWN')));
   });req.setTimeout(timeoutMs,()=>req.destroy(Error('LOCAL_DELIVERY_UNKNOWN')));req.on('error',()=>reject(Error('LOCAL_DELIVERY_UNKNOWN')));req.end(body);
  });
 }
 return {async send(input,signal){const result=await call(input.key,input,signal);if(!result)throw Error('LOCAL_DELIVERY_UNKNOWN');return result;},lookup:(key,signal)=>call(key,undefined,signal)};
}
