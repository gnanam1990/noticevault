/**
 * @noticevault/sdk — deployment descriptors
 *
 * LOCAL_FIXTURE: deterministic test descriptor. No real addresses.
 * ARC_TESTNET: readiness-only. factoryAddress=null until verified deployment.
 * ARC_MAINNET: verified contract pins; operator execution remains separately gated.
 *
 * NEVER invent real contract addresses here. Only set factoryAddress after
 * actual deployment is confirmed and recorded in implementation-records/.
 */

import type { NoticeVaultDeployment } from "./types.js";
import { SdkChainError } from "./types.js";

/**
 * LOCAL_FIXTURE — for deterministic tests only.
 * chainId=31337 (Anvil default). factoryAddress=null (caller must override for test).
 */
export const LOCAL_FIXTURE_DEPLOYMENT: NoticeVaultDeployment = {
  configIdentity:           "LOCAL_FIXTURE",
  chainId:                  31337n,
  factoryAddress:           null,
  allowlistedToken:         null,
  expectedFactoryCodeHash:  null, // no deployment exists for LOCAL_FIXTURE
  expectedTokenCodeHash:    null,
  isLive:                   false,
  label:                    "[TEST DATA] Local Fixture — not a live deployment",
};

/**
 * ARC_TESTNET — readiness descriptor.
 * factoryAddress=null until M10 verified deployment.
 * Do NOT set isLive=true here; testnet is never mainnet.
 */
export const ARC_TESTNET_DEPLOYMENT: NoticeVaultDeployment = {
  configIdentity:           "ARC_TESTNET",
  chainId:                  5042002n,
  factoryAddress:           null, // set after M10 verified deployment
  allowlistedToken:         null, // set after M10 verified deployment
  expectedFactoryCodeHash:  null, // set after M10 verified deployment
  expectedTokenCodeHash:    null,
  isLive:                   false,
  label:                    "Arc Testnet — readiness only, no verified deployment",
};

/**
 * Validate that a deployment's chainId matches the caller's connected chainId.
 * Throws SdkChainError on mismatch.
 */
export function validateDeploymentChain(
  deployment: NoticeVaultDeployment,
  connectedChainId: bigint,
): void {
  if (deployment.chainId !== connectedChainId)
    throw new SdkChainError(
      `Chain mismatch: deployment expects chainId=${deployment.chainId}, ` +
      `but connected chainId=${connectedChainId}`,
    );
}

/**
 * Assert a deployment has a non-null factoryAddress.
 * Throws SdkChainError if not deployed.
 */
export function requireFactoryAddress(deployment: NoticeVaultDeployment): string {
  if (!deployment.factoryAddress)
    throw new SdkChainError(
      `Deployment "${deployment.label}" has no factoryAddress — not yet deployed`,
    );
  return deployment.factoryAddress;
}

/** Verified factory evidence: implementation-records/mainnet-factory-20261029.json. Pins do not enable operator execution. */
export const ARC_MAINNET_DEPLOYMENT: NoticeVaultDeployment = Object.freeze({
 configIdentity: 'ARC_MAINNET', chainId: 5042n, factoryAddress: '0x801c366eb4e07162fca1f260d78338a3433d81e2', allowlistedToken: '0x3600000000000000000000000000000000000000',
 expectedFactoryCodeHash: '0x2bf50890f25141984a000a767b15b665cad108a64416422a2de3179d976b1006', expectedTokenCodeHash: '0xc9987bd3af6b26a030951faa7eacc017b68343aeedf3ce5fe68f821c4b93939d', isLive: true,
 label: 'Arc Mainnet — factory verified; application activation pending',
});
export function arcDeployment(identity: string): NoticeVaultDeployment {
 if(identity==='ARC_TESTNET')return ARC_TESTNET_DEPLOYMENT;
 if(identity==='ARC_MAINNET')return ARC_MAINNET_DEPLOYMENT;
 throw new Error('Unsupported Arc network');
}
