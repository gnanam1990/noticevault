/** M04 configuration validation only. This is not on-chain deployment proof. */
import { LOCAL_FIXTURE_DEPLOYMENT, ARC_TESTNET_DEPLOYMENT, ARC_MAINNET_DEPLOYMENT } from "@noticevault/sdk";
import type { NoticeVaultDeployment } from "@noticevault/sdk";
import type { ConfigIdentity } from "./config.js";

export function snapshotConsentDeployment(identity: ConfigIdentity, source?: NoticeVaultDeployment): NoticeVaultDeployment | null {
  if (!source) return null;
  const expected = identity === "LOCAL_FIXTURE" ? LOCAL_FIXTURE_DEPLOYMENT : identity === "ARC_TESTNET" ? ARC_TESTNET_DEPLOYMENT : identity === "ARC_MAINNET" ? ARC_MAINNET_DEPLOYMENT : null;
  if (!expected || source.configIdentity !== identity || source.chainId !== expected.chainId || source.isLive !== expected.isLive) {
    throw new Error("Consent manifest identity/chain mismatch or disabled live deployment");
  }
  if (typeof source.factoryAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(source.factoryAddress) || /^0x0{40}$/.test(source.factoryAddress)) {
    throw new Error("Consent manifest requires an explicit nonzero factory address");
  }
  if (identity !== "LOCAL_FIXTURE") {
    if (typeof source.allowlistedToken !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(source.allowlistedToken) || /^0x0{40}$/.test(source.allowlistedToken)) throw new Error("Consent manifest requires an allowlisted token");
    for (const hash of [source.expectedFactoryCodeHash, source.expectedTokenCodeHash]) {
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash) || /^0x0{64}$/.test(hash)) throw new Error("Consent manifest requires expected code hashes");
    }
  }
  return Object.freeze({ ...source });
}
