import {writeFile} from 'node:fs/promises';
import {checkFlows} from './hosted-flow';
import {checkIsolation} from './hosted-isolation';
const results:unknown[]=[];
try{await checkFlows(results,async()=>{});await checkIsolation(results,async()=>{});console.log('HOSTED_ACCEPTANCE_PASS');}
catch(e){console.error('HOSTED_ACCEPTANCE_FAILED',e instanceof Error?e.message:'UNKNOWN');process.exitCode=1;}
finally{await writeFile('/tmp/nv-hosted-acceptance.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}
