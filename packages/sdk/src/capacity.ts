import { safeAddUint256 } from "@noticevault/domain";
import type { NoticeVaultDeployment, FactoryObservation, VerifiedObservation } from "./types.js";
import { SdkStateError } from "./types.js";

/** Only this independently verified original deployment uses legacy liability caps. */
export function usesLegacyCapacity(dep: NoticeVaultDeployment): boolean {
  return dep.configIdentity === "ARC_MAINNET" && dep.chainId === 5042n &&
    dep.factoryAddress?.toLowerCase() === "0x801c366eb4e07162fca1f260d78338a3433d81e2" &&
    dep.expectedFactoryCodeHash?.toLowerCase() === "0x2bf50890f25141984a000a767b15b665cad108a64416422a2de3179d976b1006" &&
    dep.allowlistedToken?.toLowerCase() === "0x3600000000000000000000000000000000000000" &&
    dep.expectedTokenCodeHash?.toLowerCase() === "0xc9987bd3af6b26a030951faa7eacc017b68343aeedf3ce5fe68f821c4b93939d";
}

export function requireCreationCapacity(dep: NoticeVaultDeployment, e: FactoryObservation, A: bigint, initial: bigint): void {
  if (usesLegacyCapacity(dep)) return;
  if (e.factoryAllocatedCapacity === undefined || e.factoryCap === undefined || e.agreementCap === undefined)
    throw new SdkStateError("Reservation capacity evidence missing; re-observe the factory");
  const peak = safeAddUint256(initial, A, "2A+R");
  if (peak > e.agreementCap)
    throw new SdkStateError("Renewal reservation requires 2A + R <= agreement cap. Reduce the payment or notice period; initial funding remains A + R.");
  if (safeAddUint256(e.factoryAllocatedCapacity, e.agreementCap, "factory allocation") > e.factoryCap)
    throw new SdkStateError("Factory reservation capacity is full; new agreements cannot be admitted. Existing reservations are retained.");
}

export function requireRenewalCapacity(dep: NoticeVaultDeployment, e: VerifiedObservation): void {
  const A = e.observedTerms?.amountPerPeriod, L = e.contractPreview?.L;
  if (A === undefined || L === undefined || e.agreementCap === undefined || e.factoryCap === undefined || e.factoryOutstandingL === undefined)
    throw new SdkStateError("Renewal capacity evidence missing; re-observe the agreement");
  const legacy = usesLegacyCapacity(dep);
  const allocation = legacy ? e.agreementCap : e.agreementAllocation;
  if (allocation === undefined) throw new SdkStateError("Agreement reservation evidence missing; re-observe");
  const next = safeAddUint256(L, A, "renewal liability");
  if (next > allocation) {
    const claimable = e.contractPreview?.providerClaimable ?? 0n;
    if (claimable > 0n && claimable <= L && next - claimable <= allocation)
      throw new SdkStateError("Claim accrued provider earnings first, wait for confirmation, then re-observe before renewing. The claim pays the agreed provider.");
    throw new SdkStateError("Renewal exceeds this agreement's reserved capacity. Repeated early prepayments are limited; wait for accrual and re-observe.");
  }
  if (safeAddUint256(e.factoryOutstandingL, A, "factory liability") > e.factoryCap)
    throw new SdkStateError("Factory liability cap would be exceeded; re-observe after settlement");
}
