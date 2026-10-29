// API-local validation boundary; must remain equivalent to worker deployment-policy.ts. Integration tests check parity.
/** Version 1 binds the existing synthetic RPC-consistency semantics, never live finality. */
const keys=['version','mode','chainId','factory','token','tokenDecimals','factoryCodeHash','tokenCodeHash'];
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid deployment policy');return value as Record<string,unknown>;}
function hex(value:unknown,length:number):string{if(typeof value!=='string'||!new RegExp('^0x[0-9a-fA-F]{'+length+'}$').test(value)||BigInt(value)===0n)throw new Error('Invalid deployment policy hex');return value.toLowerCase();}
export function normalizeDeploymentPolicy(value:unknown){
 const p=object(value);
 if(Object.keys(p).length!==keys.length||Object.keys(p).some(k=>!keys.includes(k))||p.version!==1)throw new Error('Unsupported deployment policy shape/version');
 if(p.mode!=='SYNTHETIC'&&p.mode!=='RPC_OBSERVED')throw new Error('LIVE_TRANSPORT_NOT_ENABLED');
 if(typeof p.chainId!=='string'||!/^[1-9][0-9]*$/.test(p.chainId)||BigInt(p.chainId)>=(1n<<256n))throw new Error('Invalid deployment policy chain');
 const factory=hex(p.factory,40),token=hex(p.token,40);if(factory===token||p.tokenDecimals!==6)throw new Error('Invalid deployment policy token/Decimals');
 return Object.freeze({version:1 as const,mode:p.mode as 'SYNTHETIC'|'RPC_OBSERVED',chainId:p.chainId,factory,token,tokenDecimals:6,factoryCodeHash:hex(p.factoryCodeHash,64),tokenCodeHash:hex(p.tokenCodeHash,64)});
}
export function deploymentPolicyFromRpc(value:unknown){
 const p=object(value);return normalizeDeploymentPolicy({version:1,mode:p.mode,chainId:p.chainId,factory:p.factory,token:p.token,tokenDecimals:p.tokenDecimals,factoryCodeHash:p.factoryCodeHash,tokenCodeHash:p.tokenCodeHash});
}
