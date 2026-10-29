// @ts-check
/** Non-live workspace startup. Never creates a database, secret, or deployment. */
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
/** @param {Record<string,string|undefined>} env */
export function startupIssues(env){
 const required=['CONFIG_IDENTITY','PGHOST','PGUSER','PGPASSWORD','PGDATABASE','SESSION_SECRET','COOKIE_DOMAIN','ALLOWED_ORIGINS','ALLOWED_DOMAINS'];
 if(env.NOTICEVAULT_WORKSPACE_ONLY!=='1')required.push('NOTICEVAULT_DEPLOYMENT_MANIFEST');
 const issues=required.filter(k=>!env[k]?.trim()).map(k=>'Missing '+k);
 if(env.CONFIG_IDENTITY&&env.CONFIG_IDENTITY!=='ARC_TESTNET')issues.push('Authenticated workspace requires ARC_TESTNET; LOCAL_FIXTURE authentication is test-only.');
 if(env.PGDATABASE&&!/^noticevault_dev(?:_|$)/.test(env.PGDATABASE))issues.push('Use an explicitly designated noticevault_dev database; existing unrelated databases are not started or migrated.');
 if(env.PGHOST&&!['127.0.0.1','localhost'].includes(env.PGHOST)&&!env.PGHOST.startsWith('/tmp/'))issues.push('Development database must use loopback or a local /tmp Unix socket.');
 if(env.SESSION_SECRET&&env.SESSION_SECRET.length<32)issues.push('SESSION_SECRET must contain at least 32 characters.');
 if(env.PORT&&env.PORT!=='3001')issues.push('API PORT must be 3001 to match the existing frontend proxy.');
 if(env.NOTICEVAULT_OPERATOR_APPROVAL_CONFIG||env.NOTICEVAULT_OPERATOR_REVIEW_SHA256)issues.push('Operator execution inputs are not permitted by this non-live development command.');
 return issues;
}
/** @param {number} port @returns {Promise<boolean>} */
const listening=port=>new Promise(resolve=>{const socket=createConnection({host:'127.0.0.1',port});let done=false;/** @param {boolean} value */ const finish=(/** @type {boolean} */ value)=>{if(done)return;done=true;socket.destroy();resolve(value)};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(700,()=>finish(false));});
async function main(){
 const issues=startupIssues(process.env);if(issues.length){console.error('Workspace startup blocked before any process or database change:\n'+issues.map(s=>' - '+s).join('\n'));process.exitCode=2;return;}
 try{const {loadApiConfig}=await import('../apps/api/src/config.ts');loadApiConfig();}catch{console.error('API configuration validation failed. Check the supplied manifest and documented configuration; no values are printed.');process.exitCode=2;return;}
 if(process.argv.includes('--check')){console.log('Startup configuration accepted. Database connectivity, migrations and browser acceptance have not run.');return;}
 const apiOnly=process.argv.includes('--api-only');for(const port of apiOnly?[3001]:[3001,5173])if(await listening(port)){console.error('Port '+port+' is already in use. No process was stopped. Use dev:api when the existing frontend is running.');process.exitCode=2;return;}
 /** @type {import("node:child_process").ChildProcess[]} */ const children=[];let stopping=false;
 /** @param {number} code */ const stop=code=>{if(stopping)return;stopping=true;process.exitCode=code;for(const child of children)if(child.exitCode===null&&!child.killed)child.kill('SIGTERM');};
 process.once('SIGINT',()=>stop(130));process.once('SIGTERM',()=>stop(143));
 /** @param {string} cwd @param {string[]} args */ const start=(cwd,args)=>{const child=spawn(process.execPath,args,{cwd,env:{...process.env,HOST:'127.0.0.1',PORT:'3001'},stdio:'inherit'});children.push(child);child.once('error',()=>{console.error('Unable to start development process.');stop(1)});child.once('exit',code=>{if(!stopping)stop(code??1)});return child;};
 const api=start(root+'apps/api',['run','start']);let healthy=false;
 for(let n=0;n<60&&!stopping&&api.exitCode===null;n++){try{const response=await fetch('http://127.0.0.1:3001/health',{signal:AbortSignal.timeout(500)});healthy=response.ok;if(healthy)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 if(!healthy){console.error('API did not become healthy; frontend startup skipped. Existing resources were not reset.');stop(1);return;}
 const readiness=await fetch('http://127.0.0.1:3001/readiness',{signal:AbortSignal.timeout(1500)}).catch(()=>null);
 if(readiness?.status!==503){console.error('Expected non-live readiness gate was not confirmed; stopping these development processes.');stop(1);return;}
 console.log('Workspace API is healthy on loopback:3001; live readiness remains disabled.');
 if(!apiOnly)start(root,['run','dev','--host','0.0.0.0','--port','5173','--strictPort']);
}
if(import.meta.main)await main();
