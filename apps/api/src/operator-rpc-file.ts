import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {ALCHEMY_MAINNET_ORIGIN,type RpcEndpoints,resolveRpcEndpoint} from './operator-rpc.js';
export async function loadOperatorRpcEndpoints(path:string|undefined):Promise<RpcEndpoints>{
 if(path===undefined)return {};
 if(!isAbsolute(path))throw Error('RPC_SECRET_FILE_INVALID');
 try {
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
   const st=await file.stat();if(!st.isFile()||(st.mode&0o777)!==0o600||st.size>2048||(process.getuid&&st.uid!==process.getuid()))throw Error();
   const text=await file.readFile('utf8');
   const match=/^ALCHEMY_MAINNET_RPC_URL=([^\r\n]+)\n$/.exec(text);
   if(!match)throw Error();
   const endpoints={[ALCHEMY_MAINNET_ORIGIN]:match[1]};resolveRpcEndpoint(ALCHEMY_MAINNET_ORIGIN,endpoints);return endpoints;
  } finally {await file.close();}
 } catch {throw Error('RPC_SECRET_FILE_INVALID');}
}
