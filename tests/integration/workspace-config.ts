/** Non-secret fixture config; never connects or creates credentials. */
import assert from 'node:assert/strict';
import {loadApiConfig} from '../../apps/api/src/config';
const names=['NOTICEVAULT_OPERATOR_APPROVAL_CONFIG','NOTICEVAULT_OPERATOR_REVIEW_SHA256','NOTICEVAULT_DEPLOYMENT_MANIFEST','NOTICEVAULT_DEPLOYMENT_EVIDENCE'];
for(const key of names) delete process.env[key];
Object.assign(process.env,{CONFIG_IDENTITY:'ARC_TESTNET',NOTICEVAULT_WORKSPACE_ONLY:'1',PGHOST:'127.0.0.1',PGUSER:'fixture',PGPASSWORD:'synthetic-only',PGDATABASE:'noticevault_dev_fixture',SESSION_SECRET:'synthetic_fixture_32_bytes_not_a_real_credential',COOKIE_DOMAIN:'localhost',ALLOWED_ORIGINS:'http://localhost:5173',ALLOWED_DOMAINS:'localhost'});
assert.equal(loadApiConfig().configIdentity,'ARC_TESTNET');assert.equal(loadApiConfig().consentDeployment,undefined);
for(const key of names){process.env[key]='synthetic-forbidden-input';assert.throws(()=>loadApiConfig(),/Workspace-only/);delete process.env[key];}
delete process.env.SESSION_SECRET;assert.throws(()=>loadApiConfig(),/SESSION_SECRET/);process.env.SESSION_SECRET='synthetic_fixture_32_bytes_not_a_real_credential';
delete process.env.NOTICEVAULT_WORKSPACE_ONLY;assert.throws(()=>loadApiConfig(),/NOTICEVAULT_DEPLOYMENT_MANIFEST/);
console.log('PASS workspace-only config uses real auth identity, requires secrets, excludes all financial inputs, and preserves normal deployment gate');
