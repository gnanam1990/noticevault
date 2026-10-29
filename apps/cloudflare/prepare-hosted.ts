import {readFile,writeFile,stat} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {createPool,runMigrations} from '../../packages/db/src/index';
const file='.env.cloudflare.setup.local';
const env=Object.fromEntries((await readFile(file,'utf8')).trim().split('\n').map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
if(((await stat(file)).mode&0o777)!==0o600||env.PGDATABASE!=='noticevault'||!env.PGHOST?.endsWith('.neon.tech'))throw Error('SETUP_BINDING');
const cfg={host:env.PGHOST,port:5432,user:env.PGUSER,password:env.PGPASSWORD,database:'noticevault',schema:'noticevault',ssl:{rejectUnauthorized:true},maxConnections:2};
const p=createPool(cfg);
try{
 const identity=await p.query('select current_database() as db');if(identity.rows[0].db!=='noticevault')throw Error('WRONG_DATABASE');
 const m=await runMigrations(p,'noticevault','/home/user/app/packages/db/src/migrations');if(m.errors.length)throw Error('MIGRATION_FAILED');
 const r=await p.query("select 1 from pg_roles where rolname='noticevault_app'");if(r.rowCount)throw Error('APP_ROLE_ALREADY_EXISTS');
 const password=randomBytes(32).toString('hex');
 await p.query('BEGIN');
 await p.query("CREATE ROLE noticevault_app LOGIN PASSWORD '"+password+"' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION");
 await p.query('GRANT CONNECT ON DATABASE noticevault TO noticevault_app');
 await p.query('GRANT USAGE ON SCHEMA noticevault TO noticevault_app');
 await p.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA noticevault TO noticevault_app');
 await p.query('GRANT USAGE,SELECT,UPDATE ON ALL SEQUENCES IN SCHEMA noticevault TO noticevault_app');
 await p.query('COMMIT');
 env.PGUSER='noticevault_app';env.PGPASSWORD=password;
 await writeFile(file,Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});
 const app=createPool({...cfg,user:env.PGUSER,password});try{await app.query('select count(*) from noticevault.workspaces');}finally{await app.end();}
 console.log('HOSTED_DATABASE_TLS_MIGRATIONS_APP_ROLE_PASS');
}catch(e){console.error('HOSTED_SETUP_FAILED',e instanceof Error?e.message:'UNKNOWN');process.exitCode=1;}finally{await p.end();}
