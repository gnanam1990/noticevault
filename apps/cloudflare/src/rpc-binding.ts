import {createOperatorReaderFactory,ALCHEMY_MAINNET_ORIGIN} from '../../api/src/operator-rpc';
/** Only encrypted server bindings enter this adapter; public review pins remain bare origins. */
export function createHostedOperatorReader(secret:string|undefined,fetcher:typeof fetch=fetch){
 return createOperatorReaderFactory(secret===undefined?{}:{[ALCHEMY_MAINNET_ORIGIN]:secret},fetcher);
}
