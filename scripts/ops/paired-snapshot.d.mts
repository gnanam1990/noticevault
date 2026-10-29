import type {RpcClient} from './preflight.mjs';
import type {Hex} from 'viem';
type Header={number:bigint;hash:Hex;timestamp:bigint};
export declare const SNAPSHOT_POLICY:Readonly<{maxHeadLag:bigint;maxHeadTimeSkew:bigint;maxAgeMs:number;futureSkewMs:number}>;
export declare class SnapshotError extends Error {diagnostic:{method:string;stage:string;headers:{provider:number;number:string;hash:Hex;timestamp:string}[]};constructor(reason:string,stage:string,headers?:Header[]);}
export declare function sharedSnapshot(clients:RpcClient[],clock:()=>number):Promise<Header>;
export declare function verifySnapshot(clients:RpcClient[],snapshot:Header,clock:()=>number):Promise<void>;
