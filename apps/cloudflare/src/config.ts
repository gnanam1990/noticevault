import type {ApiConfig} from '../../api/src/config';
export function cloudConfig(env:Record<string,string>):ApiConfig{
 const required=(key:string)=>{const value=env[key];if(!value)throw Error('MISSING_'+key);return value;};
 const origin=new URL(required('PUBLIC_ORIGIN'));if(origin.protocol!=='https:'||origin.origin!==env.PUBLIC_ORIGIN||origin.username||origin.password)throw Error('EXACT_HTTPS_ORIGIN_REQUIRED');
 const network=required('CONFIG_IDENTITY');if(network!=='ARC_MAINNET'&&network!=='ARC_TESTNET')throw Error('ARC_NETWORK_REQUIRED');
 const secret=required('SESSION_SECRET');if(secret.length<32)throw Error('SESSION_SECRET_TOO_SHORT');
 const schema=required('PGSCHEMA');if(!/^[a-z][a-z0-9_]{0,62}$/.test(schema))throw Error('INVALID_PGSCHEMA');
 const host=required('PGHOST');if(!/^[a-z0-9.-]+$/i.test(host)||host==='localhost'||host==='127.0.0.1')throw Error('HOSTED_DATABASE_REQUIRED');
 return {configIdentity:network,host:'127.0.0.1',port:3001,db:{host,port:5432,user:required('PGUSER'),password:required('PGPASSWORD'),database:required('PGDATABASE'),schema,ssl:{rejectUnauthorized:true},maxConnections:2},sessionSecret:secret,cookieDomain:origin.hostname,allowedOrigins:[origin.origin],allowedDomains:[origin.hostname],sessionTtlSecs:86400,challengeTtlSecs:300};
}
