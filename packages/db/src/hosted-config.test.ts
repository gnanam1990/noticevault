import {afterEach,describe,it,expect,vi} from 'vitest';
import {loadDbConfig} from './config.js';
import {createPool} from './pool.js';
afterEach(()=>vi.unstubAllEnvs());
function env(){for(const [k,v] of Object.entries({PGHOST:'db.example.invalid',PGPORT:'5432',PGUSER:'synthetic',PGPASSWORD:'synthetic-test-only',PGDATABASE:'synthetic',PGSCHEMA:'synthetic',PGSSLMODE:'',PGPOOL_MAX:undefined}))vi.stubEnv(k,v);}
describe('remote database transport configuration',()=>{
 it('preserves local defaults',()=>{env();expect(loadDbConfig().ssl).toBeUndefined();expect(loadDbConfig().maxConnections).toBeUndefined();});
 it('passes verified TLS and bounded pool to pg without connecting',async()=>{env();vi.stubEnv('PGSSLMODE','verify-full');vi.stubEnv('PGPOOL_MAX','2');const cfg=loadDbConfig(),pool=createPool(cfg);expect(pool.options.ssl).toEqual({rejectUnauthorized:true});expect(pool.options.max).toBe(2);expect(pool.totalCount).toBe(0);await pool.end();});
 it.each(['require','prefer','allow','verify-ca','invalid'])('rejects unsafe TLS mode %s',mode=>{env();vi.stubEnv('PGSSLMODE',mode);expect(()=>loadDbConfig()).toThrow('PGSSLMODE');});
 it.each(['0','11','2.5','2x','-1',''])('rejects invalid pool bound %s',value=>{env();vi.stubEnv('PGPOOL_MAX',value);expect(()=>loadDbConfig()).toThrow('PGPOOL_MAX');});
});
