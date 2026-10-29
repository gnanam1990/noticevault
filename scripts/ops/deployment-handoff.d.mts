import { preflight } from './preflight.mjs';
/** @param {Parameters<typeof preflight>[0]} input */
export declare function prepareDeploymentHandoff(input: Parameters<typeof preflight>[0]): Promise<{
    artifact: {
        format: string;
        purpose: string;
        reviewSha256: string | undefined;
        sourceHead: string;
        artifactSha256: string;
        createdAt: number;
        expiresAt: number;
        transaction: {
            chainId: number;
            from: `0x${string}`;
            to: null;
            data: `0x${string}`;
            value: string;
        };
        constructorArgs: string[];
        initCodeKeccak: `0x${string}`;
        observedBlock: {
            timestamp: bigint;
            number: bigint;
            hash: `0x${string}`;
        };
        requiredBeforeExecution: string[];
        executionEnabled: boolean;
    };
    sha256: string;
    checksumMeaning: string;
}>;
/** @param {unknown} value @param {Parameters<typeof preflight>[0]} input */
export declare function validateDeploymentHandoff(value: unknown, input: Parameters<typeof preflight>[0]): Promise<{
    status: string;
    reviewSha256: string | undefined;
    initCodeKeccak: `0x${string}`;
    freshObservedBlock: {
        timestamp: bigint;
        number: bigint;
        hash: `0x${string}`;
    };
    executionEnabled: boolean;
}>;
