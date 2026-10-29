import type { FactoryObservation, NoticeVaultDeployment } from "./types.js";
import { SdkStateError, SdkChainError } from "./types.js";
import { _isIssuedFactoryObservation, _matchesFactoryDeployment } from "./snapshot.js";

const MAX_EVIDENCE_AGE_MS = 60_000;
const MAX_BLOCK_AGE_S = 7_200n;

export function requireFreshFactoryEvidence(
  evidence: FactoryObservation,
  dep: NoticeVaultDeployment,
  label: string,
): void {
  if (!_isIssuedFactoryObservation(evidence))
    throw new SdkStateError(
      `${label}: factoryEvidence was not issued by observeFactoryForCreation — fabricated or VerifiedObservation objects not accepted`,
    );
  if (evidence.status !== "ok")
    throw new SdkStateError(`${label}: factoryEvidence status is "${evidence.status}": ${evidence.statusDetail ?? ""}`);
  if (evidence.block.chainId !== dep.chainId)
    throw new SdkChainError(`${label}: factoryEvidence chainId ${evidence.block.chainId} ≠ ${dep.chainId}`);
  if (evidence.configIdentity !== dep.configIdentity)
    throw new SdkChainError(`${label}: factoryEvidence configIdentity mismatch`);

  if (!_matchesFactoryDeployment(evidence, dep))
    throw new SdkStateError(`${label}: factoryEvidence deployment policy mismatch`);

  const nowMs = Date.now();
  if (evidence.block.observedAt > nowMs + 5_000)
    throw new SdkStateError(`${label}: factoryEvidence observedAt is in the future`);
  const ageMs = nowMs - evidence.block.observedAt;
  if (ageMs > MAX_EVIDENCE_AGE_MS)
    throw new SdkStateError(`${label}: factoryEvidence is stale (${ageMs}ms old, max ${MAX_EVIDENCE_AGE_MS}ms)`);

  // Block timestamp staleness
  const nowSeconds = BigInt(Math.floor(nowMs / 1000));
  if (evidence.block.blockTimestamp > nowSeconds + 30n)
    throw new SdkStateError(`${label}: factoryEvidence block timestamp is in the future`);
  if (evidence.block.blockTimestamp < nowSeconds - MAX_BLOCK_AGE_S)
    throw new SdkStateError(
      `${label}: factoryEvidence block timestamp is too old (block=${evidence.block.blockTimestamp}, now=${nowSeconds}, maxAge=${MAX_BLOCK_AGE_S}s)`,
    );
}

