/** Configuration-only startup mode: no database, network, wallet or executor construction. */
import {readFileSync,statSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import type {NoticeVaultDeployment} from '@noticevault/sdk';
import {loadArcTestnetManifest} from './deployment-manifest.js';
import {inspectDeploymentRecord} from './deployment-record.js';
import type {DeploymentAssessment} from './deployment-record.js';
function blocked(code:string):DeploymentAssessment{return Object.freeze({state:'BLOCKED',executionEnabled:false,runtimeVerified:false,diagnostics:Object.freeze([code])});}
export function loadDeploymentAssessment(path:string|undefined,dep:NoticeVaultDeployment|undefined):DeploymentAssessment{
 if(path===undefined)return inspectDeploymentRecord(undefined,dep);
 try{if(!isAbsolute(path)||!statSync(path).isFile()||statSync(path).size>65536)return blocked('INVALID_DEPLOYMENT_RECORD_PATH');return inspectDeploymentRecord(readFileSync(path,'utf8'),dep);}catch{return blocked('DEPLOYMENT_RECORD_UNREADABLE');}
}
export function runVerificationStartup(args:readonly string[]):Readonly<{exitCode:number;report:DeploymentAssessment}>{
 if(args.length!==3||args[0]!=='--verify-deployment')return {exitCode:1,report:blocked('USAGE_VERIFY_DEPLOYMENT_DESCRIPTOR_RECORD')};
 let dep:NoticeVaultDeployment;try{dep=loadArcTestnetManifest(args[1]!);}catch{return {exitCode:1,report:blocked('DEPLOYMENT_DESCRIPTOR_UNAVAILABLE_OR_INVALID')};}
 const report=loadDeploymentAssessment(args[2],dep);
 // A syntactically complete record is not a deployment acceptance pass.
 return Object.freeze({exitCode:report.state==='BLOCKED'?1:2,report});
}
