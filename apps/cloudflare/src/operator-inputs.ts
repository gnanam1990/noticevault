import {parseOperatorApprovalInputs,type OperatorReaderFactory} from '../../api/src/operator-inputs';
export type HostedOperatorBundle=Readonly<{config:string;files:Readonly<Record<string,string>>}>;
/** Compiled artifact bytes and separately configured independent review pin; never HTTP input. */
export async function loadHostedOperatorInputs(bundle:HostedOperatorBundle|null,pin:string|undefined,deps:{reader?:OperatorReaderFactory}={}){
 if(bundle===null&&pin===undefined)return undefined;
 if(!bundle||!pin)throw Error('HOSTED_OPERATOR_INPUTS_REQUIRED');
 if(Object.keys(bundle).sort().join()!=='config,files'||typeof bundle.config!=='string'||!bundle.files||typeof bundle.files!=='object'||Array.isArray(bundle.files))throw Error('HOSTED_OPERATOR_BUNDLE_INVALID');
 const names=Object.keys(bundle.files);if(names.length<5||names.length>37)throw Error('HOSTED_OPERATOR_FILES_INVALID');
 let total=Buffer.byteLength(bundle.config);const files=new Map<string,Uint8Array>();
 for(const name of names){const value=bundle.files[name];if(typeof value!=='string'||value.length>1398104||!value||value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw Error('HOSTED_OPERATOR_ENCODING');
 const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value)throw Error('HOSTED_OPERATOR_ENCODING');total+=bytes.length;if(bytes.length>1048576||total>4194304)throw Error('OPERATOR_ARTIFACT_SIZE');files.set(name,bytes); }
 const used=new Set<string>();const result=await parseOperatorApprovalInputs(new TextEncoder().encode(bundle.config),pin,async name=>{const bytes=files.get(name);if(!bytes)throw Error('HOSTED_OPERATOR_FILE_MISSING');used.add(name);return bytes;},deps);
 if(used.size!==files.size)throw Error('HOSTED_OPERATOR_UNREFERENCED_FILE');return result;
}
