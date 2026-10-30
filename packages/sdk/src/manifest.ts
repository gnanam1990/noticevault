import type {Hex} from 'viem';
import {arcDeployment,assertRegisteredArcDeploymentPins} from './deployments.js';
import type {NoticeVaultDeployment} from './types.js';
const keys=['configIdentity','chainId','factoryAddress','allowlistedToken','expectedFactoryCodeHash','expectedTokenCodeHash','isLive','label'];
function invalid():never{throw new Error('Invalid Arc deployment manifest');}
export function parseArcManifest(text:string, expectedIdentity?:string):NoticeVaultDeployment{
 if(typeof text!=='string'||text.length===0||text.length>16384)return invalid();
 let value:unknown;try{value=JSON.parse(text);}catch{return invalid();}
 if(!value||typeof value!=='object'||Array.isArray(value))return invalid();
 const v=value as Record<string,unknown>;
 if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.prototype.hasOwnProperty.call(v,k)))return invalid();
 // Consume whole JSON strings; label contents cannot masquerade as keys.
 const seen=new Set<string>();const strings=/"(?:\\.|[^"\\])*"/g;
 for(const match of text.matchAll(strings)){
  if(!/^\s*:/.test(text.slice(match.index!+match[0].length)))continue;
  const key=JSON.parse(match[0]) as string;if(seen.has(key))return invalid();seen.add(key);
 }
 let network:NoticeVaultDeployment;try{network=arcDeployment(String(v.configIdentity));}catch{return invalid();}
 if((expectedIdentity!==undefined&&v.configIdentity!==expectedIdentity)||v.chainId!==String(network.chainId)||v.isLive!==network.isLive)return invalid();
 if(typeof v.label!=='string'||v.label.trim()!==v.label||!v.label||v.label.length>256||/[\u0000-\u001f\u007f]/.test(v.label))return invalid();
 const parsed:NoticeVaultDeployment={configIdentity:network.configIdentity,chainId:network.chainId,factoryAddress:v.factoryAddress as string,allowlistedToken:v.allowlistedToken as string,expectedFactoryCodeHash:v.expectedFactoryCodeHash as Hex,expectedTokenCodeHash:v.expectedTokenCodeHash as Hex,isLive:network.isLive,label:v.label};
 for(const address of [parsed.factoryAddress,parsed.allowlistedToken]) if(typeof address!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(address)||/^0x0{40}$/.test(address))return invalid();
 for(const hash of [parsed.expectedFactoryCodeHash,parsed.expectedTokenCodeHash])if(typeof hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(hash)||/^0x0{64}$/.test(hash))return invalid();
 if(parsed.configIdentity==='ARC_MAINNET'){try{assertRegisteredArcDeploymentPins('ARC_MAINNET',parsed);}catch{return invalid();}}
 return Object.freeze(parsed);
}

export function parseArcTestnetManifest(text:string):NoticeVaultDeployment{return parseArcManifest(text,'ARC_TESTNET');}
