export function operationalSnapshotSql(schema:string,workspaceIds?:string[]):string;
export function evaluateOperationalSignals(snapshot:unknown):{status:string;alerts:string[];counters:Record<string,number|null>;liveReadiness:string;rpcDisagreement:string;capHeadroom:string;transferFailureMeaning:string;identifiersRedacted:boolean};
