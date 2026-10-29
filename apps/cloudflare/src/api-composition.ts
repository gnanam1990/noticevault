import type pg from 'pg';
import type {ApiConfig} from '../../api/src/config';
import {buildConfiguredServer} from '../../api/src/configured-startup';
import type {OperatorReaderFactory} from '../../api/src/operator-inputs';
import {loadHostedOperatorInputs,type HostedOperatorBundle} from './operator-inputs';
export async function buildHostedApi(cfg:ApiConfig,pool:pg.Pool,bundle:HostedOperatorBundle|null,pin:string|undefined,deps:{reader?:OperatorReaderFactory}={}){
 const operatorInputs=await loadHostedOperatorInputs(bundle,pin,deps);
 return buildConfiguredServer({pool,skipMigration:true,logger:false,cfg,...(operatorInputs?{operatorInputs}:{})});
}
