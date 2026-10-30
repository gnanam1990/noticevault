import type {WorkerStatus} from '../../worker/src/worker';
/** Retry a bounded unfinished batch promptly; errors and no-progress cancellation back off. */
export function nextIndexerDelay(status:WorkerStatus|undefined,idleInterval:number){
 if(!Number.isInteger(idleInterval)||idleInterval<60000||idleInterval>3600000)throw Error('INDEXER_INTERVAL_REQUIRED');
 return status&&(status.state==='limit'||(status.state==='stopped'&&status.steps>0))?1000:idleInterval;
}
