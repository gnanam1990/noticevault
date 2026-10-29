import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import type {NoticeVaultDeployment} from '@noticevault/sdk';
import {parseArcTestnetManifest,parseArcManifest} from '@noticevault/sdk';
export {parseArcTestnetManifest,parseArcManifest} from '@noticevault/sdk';
function invalid():never{throw new Error('Invalid ARC_TESTNET deployment manifest');}
export function loadArcTestnetManifest(path:string,readText:(path:string)=>string=p=>readFileSync(p,'utf8')):NoticeVaultDeployment{
 if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0')||path.length>4096)return invalid();
 return parseArcTestnetManifest(readText(path));
}

export function loadArcManifest(path:string,identity:string,readText:(path:string)=>string=(p)=>readFileSync(p,'utf8')):NoticeVaultDeployment{
 if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0')||path.length>4096)return invalid();
 return parseArcManifest(readText(path),identity);
}
