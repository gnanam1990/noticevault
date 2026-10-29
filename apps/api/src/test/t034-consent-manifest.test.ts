import { describe, it, expect } from "vitest";
import { LOCAL_FIXTURE_DEPLOYMENT, ARC_TESTNET_DEPLOYMENT } from "@noticevault/sdk";
import { snapshotConsentDeployment } from "../consent-manifest.js";
// Synthetic test-only address; no deployed contract. arc-studio-allow-onchain-literal
const factory = "0x0000000000000000000000000000000000000001";
const valid = { ...LOCAL_FIXTURE_DEPLOYMENT, factoryAddress: factory };
describe("T034 consent manifest configuration boundary (not on-chain proof)", () => {
  it("has no invented factory fallback", () => expect(snapshotConsentDeployment("LOCAL_FIXTURE")).toBeNull());
  it("copies and freezes accepted configuration", () => { const input = { ...valid }; const result = snapshotConsentDeployment("LOCAL_FIXTURE", input)!; input.factoryAddress = "changed"; expect(result.factoryAddress).toBe(factory); expect(Object.isFrozen(result)).toBe(true); });
  it.each([null, "", "invalid", "0x" + "0".repeat(40)])("rejects missing or invalid factory %s", factoryAddress => expect(() => snapshotConsentDeployment("LOCAL_FIXTURE", { ...valid, factoryAddress })).toThrow(/factory address/));
  it("rejects chain mismatch", () => expect(() => snapshotConsentDeployment("LOCAL_FIXTURE", { ...valid, chainId: 1n })).toThrow(/chain mismatch/));
  it("rejects identity mismatch", () => expect(() => snapshotConsentDeployment("LOCAL_FIXTURE", { ...valid, configIdentity: "ARC_TESTNET" })).toThrow(/identity/));
  it("rejects live flag", () => expect(() => snapshotConsentDeployment("LOCAL_FIXTURE", { ...valid, isLive: true })).toThrow(/live deployment/));
  it("rejects incomplete testnet deployment policy", () => expect(() => snapshotConsentDeployment("ARC_TESTNET", { ...ARC_TESTNET_DEPLOYMENT, factoryAddress: factory })).toThrow(/allowlisted token/));
  it("rejects missing testnet code hashes", () => expect(() => snapshotConsentDeployment("ARC_TESTNET", { ...ARC_TESTNET_DEPLOYMENT, factoryAddress: factory, allowlistedToken: factory })).toThrow(/code hashes/));
});
