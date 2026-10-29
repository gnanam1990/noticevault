import {afterEach,describe,it,expect,vi} from 'vitest';
import {loadApiConfig} from '../config.js';
import {loadArcManifest} from '../deployment-manifest.js';
import {loadDbConfig} from '@noticevault/db';
vi.mock('../deployment-manifest.js',()=>({loadArcManifest:vi.fn()}));
vi.mock('@noticevault/db',()=>({loadDbConfig:vi.fn(()=>({})),localFixtureDbConfig:vi.fn(()=>({}))}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
function env(){for(const [k,v] of Object.entries({CONFIG_IDENTITY:'ARC_TESTNET',NOTICEVAULT_DEPLOYMENT_MANIFEST:'/synthetic/descriptor.json',SESSION_SECRET:'TEST_ONLY_NOT_A_CREDENTIAL',COOKIE_DOMAIN:'synthetic.invalid',ALLOWED_ORIGINS:'https://synthetic.invalid',ALLOWED_DOMAINS:'synthetic.invalid'}))vi.stubEnv(k,v);}
describe('Arc configuration descriptor loading',()=>{
 it('loads mainnet with explicit matching loader identity',()=>{env();vi.stubEnv('CONFIG_IDENTITY','ARC_MAINNET');vi.mocked(loadArcManifest).mockReturnValue({configIdentity:'ARC_MAINNET',chainId:5042n} as never);expect(loadApiConfig().configIdentity).toBe('ARC_MAINNET');expect(loadArcManifest).toHaveBeenCalledWith('/synthetic/descriptor.json','ARC_MAINNET');});
 it('loads required explicit descriptor into configuration',()=>{env();const descriptor={configIdentity:'ARC_TESTNET' as const,chainId:5042002n,factoryAddress:null,allowlistedToken:null,expectedFactoryCodeHash:null,expectedTokenCodeHash:null,isLive:false,label:'synthetic mock loader result'};vi.mocked(loadArcManifest).mockReturnValue(descriptor);expect(loadApiConfig().consentDeployment).toBe(descriptor);expect(loadArcManifest).toHaveBeenCalledWith('/synthetic/descriptor.json','ARC_TESTNET');});
 it('fails before database setup when manifest path is absent',()=>{env();vi.stubEnv('NOTICEVAULT_DEPLOYMENT_MANIFEST','');expect(()=>loadApiConfig()).toThrow('NOTICEVAULT_DEPLOYMENT_MANIFEST');expect(loadArcManifest).not.toHaveBeenCalled();expect(loadDbConfig).not.toHaveBeenCalled();});
 it('does not fall back after manifest rejection',()=>{env();vi.mocked(loadArcManifest).mockImplementation(()=>{throw new Error('invalid descriptor');});expect(()=>loadApiConfig()).toThrow('invalid descriptor');expect(loadDbConfig).not.toHaveBeenCalled();});
 it('does not read a testnet manifest for local fixture mode',()=>{vi.stubEnv('CONFIG_IDENTITY','LOCAL_FIXTURE');vi.stubEnv('LOCAL_FIXTURE_FACTORY_ADDRESS','');loadApiConfig();expect(loadArcManifest).not.toHaveBeenCalled();});
});
