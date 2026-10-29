export type Address = import('viem').Address;
export type Hex = import('viem').Hex;
export type Plan = {
    version: number;
    identity: string;
    chainId: number;
    token: Address;
    guardian: Address;
    signer: Address;
    tokenDecimals: number;
    nativeGasDecimals: number;
    tokenRuntimeKeccak: Hex;
    sourceHead: string;
    artifactSha256: string;
    artifactPath: string;
    guardianScope: string;
    signerReviewed: boolean;
    periodAmount: string;
    noticeReserve: string;
    agreementCap: string;
    factoryCap: string;
    reviewedMaxLiability: string;
    periodSeconds: string;
    noticeSeconds: string;
    rpcUrls: string[];
    deployedFactory?: {
        address: Address;
        runtimeKeccak: Hex;
    };
};
export type ChainBlock = {
    number: bigint | null;
    hash: Hex | null;
    timestamp: bigint;
};
export type ContractRead = {
    address: Address;
    abi: import('viem').Abi;
    functionName: string;
    args?: readonly unknown[];
    blockNumber: bigint;
    account?: Address;
};
export type RpcClient = {
    getChainId: () => Promise<number>;
    getBlock: (options: {
        blockTag: 'latest';
    } | {
        blockNumber: bigint;
    }) => Promise<ChainBlock>;
    getCode: (options: {
        address: Address;
        blockNumber: bigint;
    }) => Promise<Hex | undefined>;
    readContract: (options: ContractRead) => Promise<unknown>;
    simulateContract: (options: ContractRead) => Promise<{
        result: unknown;
    }>;
    getBalance: (options: {
        address: Address;
        blockNumber: bigint;
    }) => Promise<bigint>;
};
/** @param {unknown} value @returns {Plan} */
export declare function parsePlan(value: unknown): Plan;
/** @param {unknown} value */
export declare function validatePlan(value: unknown): {
    factory: bigint;
    agreement: bigint;
};
/** @param {Plan} p @param {string} root */
export declare function inspectArtifacts(p: Plan, root?: string): {
    artifact: {
        abi: readonly [{
            readonly type: 'constructor';
            readonly stateMutability: "nonpayable";
            readonly inputs: readonly [{
                readonly type: "address";
                readonly name: "guardian";
            }, {
                readonly type: "address";
                readonly name: "token";
            }, {
                readonly type: "uint256";
                readonly name: "factoryCap";
            }, {
                readonly type: "uint256";
                readonly name: "agreementCap";
            }];
        }];
        bytecode: {
            object: `0x${string}`;
        };
    };
    artifactSha256: string;
    sourceHead: string;
    compiler: string;
    settings: Record<string, unknown>;
    toolchain: {
        runtime: string;
        bun: string | null;
        foundryConfigSha256: string;
        lockfileSha256: string;
    };
};
/** @param {Plan} p @param {RpcClient[]} clients @param {number} now */
export declare function inspectChain(p: Plan, clients: RpcClient[], now?: number): Promise<{
    deployed: {
        factoryCap: bigint;
        agreementCap: bigint;
        outstandingLiability: bigint;
        headroom: bigint;
        creationPaused: boolean;
        alerts: string[];
        observedAtBlock: bigint;
    } | null;
    block: {
        timestamp: bigint;
        number: bigint;
        hash: `0x${string}`;
    };
    tokenRuntimeKeccak: `0x${string}`;
    tokenDecimals: number;
    nativeGasDecimals: number;
    signerGasBalance: bigint;
    zeroValueEthCallChecks: string;
}>;
/** @param {{bytes:Uint8Array,reviewSha256?:string,root?:string,clients?:RpcClient[],now?:number}} options */
export declare function preflight({ bytes, reviewSha256, root, clients, now }: {
    bytes: Uint8Array;
    reviewSha256?: string;
    root?: string;
    clients?: RpcClient[];
    now?: number;
}): Promise<{
    status: string;
    blockers: string[];
    deploymentAuthorized: boolean;
    signerControlVerified: boolean;
    reviewSha256: string;
    sourceHead: string;
    artifactSha256: string;
    compiler: string;
    compilerSettings: Record<string, unknown>;
    toolchain: {
        runtime: string;
        bun: string | null;
        foundryConfigSha256: string;
        lockfileSha256: string;
    };
    chainId: number;
    guardianScope: string;
    constructorArgs: string[];
    initCodeKeccak: `0x${string}`;
    chain: {
        deployed: {
            factoryCap: bigint;
            agreementCap: bigint;
            outstandingLiability: bigint;
            headroom: bigint;
            creationPaused: boolean;
            alerts: string[];
            observedAtBlock: bigint;
        } | null;
        block: {
            timestamp: bigint;
            number: bigint;
            hash: `0x${string}`;
        };
        tokenRuntimeKeccak: `0x${string}`;
        tokenDecimals: number;
        nativeGasDecimals: number;
        signerGasBalance: bigint;
        zeroValueEthCallChecks: string;
    };
    warning: string;
}>;
/** @param {Plan} p @param {RpcClient[]} clients @param {{number:bigint,hash:Hex}} block */
export declare function inspectDeployedFactory(p: Plan, clients: RpcClient[], block: {
    number: bigint;
    hash: Hex;
}): Promise<{
    factoryCap: bigint;
    agreementCap: bigint;
    outstandingLiability: bigint;
    headroom: bigint;
    creationPaused: boolean;
    alerts: string[];
    observedAtBlock: bigint;
}>;
