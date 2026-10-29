import {createOperatorReaderFactory} from './operator-rpc.js';
import {loadOperatorRpcEndpoints} from './operator-rpc-file.js';
import {readFile} from 'node:fs/promises';
import {dirname,resolve,isAbsolute,sep} from 'node:path';
import {parseOperatorApprovalInputs,type OperatorReaderFactory} from './operator-inputs.js';
export type {OperatorStartupInputs} from './operator-inputs.js';
export async function loadOperatorApprovalInputs(env:Record<string,string|undefined>=process.env,deps:{read?:(path:string)=>Promise<Uint8Array>;reader?:OperatorReaderFactory}={}){
 const path=env.NOTICEVAULT_OPERATOR_APPROVAL_CONFIG,pin=env.NOTICEVAULT_OPERATOR_REVIEW_SHA256;
 if(!path&&!pin)return undefined;
 if(!path||!isAbsolute(path)||!pin||!/^0x[0-9a-f]{64}$/.test(pin))throw Error('OPERATOR_STARTUP_INPUTS_REQUIRED');
 const base=dirname(path),read=deps.read??readFile;
 return parseOperatorApprovalInputs(await read(path),pin,async name=>{const file=resolve(base,name);if(!file.startsWith(base+sep))throw Error('OPERATOR_ARTIFACT_PATH');return read(file);},{...deps,reader:deps.reader??createOperatorReaderFactory(await loadOperatorRpcEndpoints(env.NOTICEVAULT_OPERATOR_RPC_ENDPOINT_FILE))});
}
