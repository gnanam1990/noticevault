/**
 * @noticevault/api — injected read-only signature verification
 *
 * SECURITY CONTRACT:
 * - No custody: we never hold private keys.
 * - Injected read-only: we only verify (ecrecover / ERC-1271 isValidSignature).
 * - Challenge binding: every challenge encodes origin/domain/chain/address/nonce/uri/issuedAt.
 * - Replay prevention: challenges are consumed atomically in a transaction before
 *   the session is created (both happen in the same DB transaction in auth.ts).
 *
 * VerifyResult variants:
 *   { ok: true,  method: 'ecdsa'|'erc1271', recoveredAddress: `0x${string}` }
 *   { ok: false, reason: string }
 *
 * ACCOUNT TYPE DETERMINATION:
 * - ecdsaVerifier: pure ECDSA (EOA). Attempts ecrecover via viem verifyMessage.
 *   If address has no code on chain, this is correct. If it does, caller should
 *   use erc1271Verifier instead. Without chain access, we cannot determine this;
 *   the caller (auth route) must pick the appropriate verifier based on deployment.
 *
 * - erc1271Verifier: requires a live RPC client + pinned block evidence.
 *   Takes an injectable ReadContractFn so tests can provide a deterministic mock.
 *   Returns UNKNOWN (ok=false, reason="UNKNOWN: ...") when RPC is not available.
 *   Returns ok=false when isValidSignature returns wrong magic or reverts.
 *
 * - localFixtureVerifier: accepts any signature for whitelisted sentinel test
 *   addresses. NEVER allowed in production — the server.ts gating enforces this.
 *
 * ERC-1271 MAGIC VALUE: bytes4(keccak256("isValidSignature(bytes32,bytes)")) = 0x1626ba7e
 *
 * TEST VECTOR (documented deterministic key — NOT a real wallet):
 *   privateKey: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *   address:    0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266  (Hardhat account 0)
 *   This key is publicly documented in Hardhat/Foundry and has no real funds.
 *   It is used only for deterministic EOA sign/verify round-trip tests.
 */

import { verifyMessage, hexToBytes, toHex } from "viem";

export interface VerifyOk {
  ok:               true;
  method:           "ecdsa" | "erc1271";
  recoveredAddress: `0x${string}`;
}

export interface VerifyFail {
  ok:     false;
  reason: string;
}

export type VerifyResult = VerifyOk | VerifyFail;

export interface SignatureVerifier {
  /** Optional issued-evidence recheck before session commit; never supplied by HTTP. */
  revalidate?(result: VerifyOk): Promise<boolean>;
  /**
   * Verify a sign-in message signature.
   * @param message    The exact string the wallet was asked to sign.
   * @param signature  Hex signature (0x-prefixed) from the wallet.
   * @param address    Expected signer address (0x-prefixed, any case).
   * @param chainId    Chain ID bound to the challenge.
   */
  verify(
    message:   string,
    signature: string,
    address:   string,
    chainId:   bigint,
  ): Promise<VerifyResult>;
}

// ── ERC-1271 interface ────────────────────────────────────────────────────────

/** 0x1626ba7e = bytes4(keccak256("isValidSignature(bytes32,bytes)")) */
const ERC1271_MAGIC_VALUE = "0x1626ba7e";

/**
 * Injectable function type for calling isValidSignature on a contract wallet.
 * Tests inject a deterministic mock; production injects a real viem client.
 */
export type ReadContractFn = (params: {
  address:    `0x${string}`;
  chainId:    bigint;
  msgHash:    `0x${string}`;   // bytes32 message hash
  sigBytes:   `0x${string}`;   // signature bytes
}) => Promise<`0x${string}`>;  // returns bytes4 magic value or throws

// ── EOA ECDSA verifier (viem-based, read-only) ────────────────────────────────

export const ecdsaVerifier: SignatureVerifier = {
  async verify(message, signature, address, _chainId): Promise<VerifyResult> {
    try {
      const sig     = signature as `0x${string}`;
      const addrLC  = address.toLowerCase() as `0x${string}`;

      const valid = await verifyMessage({
        address:   addrLC,
        message,
        signature: sig,
      });

      if (valid) {
        return { ok: true, method: "ecdsa", recoveredAddress: addrLC };
      }
      return { ok: false, reason: "ECDSA signature does not match address" };
    } catch (err) {
      return {
        ok:     false,
        reason: `ECDSA verify error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

// ── ERC-1271 contract-wallet verifier ────────────────────────────────────────

/**
 * Build an ERC-1271 verifier backed by an injectable ReadContractFn.
 * The readContract function must call isValidSignature(bytes32,bytes) and
 * return the bytes4 result. It should use pinned block evidence when available.
 *
 * Returns UNKNOWN (ok=false, reason="UNKNOWN:...") when readContract is null.
 * Returns ok=false when the magic value does not match or readContract throws.
 */
export function buildErc1271Verifier(
  readContract: ReadContractFn | null,
): SignatureVerifier {
  return {
    async verify(message, signature, address, chainId): Promise<VerifyResult> {
      if (readContract === null) {
        return {
          ok:     false,
          reason: "UNKNOWN: ERC-1271 verification requires a live RPC client (not configured)",
        };
      }

      try {
        // Hash the message the same way eth_sign does: personal_sign hash
        const msgBytes = new TextEncoder().encode(message);
        const prefix   = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${msgBytes.length}`);
        const combined = new Uint8Array(prefix.length + msgBytes.length);
        combined.set(prefix);
        combined.set(msgBytes, prefix.length);

        const { keccak256: keccak } = await import("viem");
        const msgHash  = keccak(toHex(combined));
        const sigBytes = signature as `0x${string}`;
        const addrLC   = address.toLowerCase() as `0x${string}`;

        const result = await readContract({ address: addrLC, chainId, msgHash, sigBytes });

        // Exact bytes4 comparison — result must be exactly 4 bytes (0x + 8 hex chars).
        // startsWith would accept 0x1626ba7e<extra-bytes> which is wrong; the spec
        // requires the returned bytes4 to equal 0x1626ba7e exactly (no more, no less).
        const resultNorm = result.toLowerCase();
        if (resultNorm === ERC1271_MAGIC_VALUE) {
          return { ok: true, method: "erc1271", recoveredAddress: addrLC };
        }
        return {
          ok:     false,
          reason: `ERC-1271: wrong magic value returned: ${result}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Distinguish revert (contract call failure) from infrastructure error
        if (msg.includes("revert") || msg.includes("execution reverted")) {
          return { ok: false, reason: `ERC-1271: isValidSignature reverted: ${msg}` };
        }
        return {
          ok:     false,
          reason: `UNKNOWN: ERC-1271 call error: ${msg}`,
        };
      }
    },
  };
}

/** Convenience: ERC-1271 verifier with no RPC — always returns UNKNOWN */
export const erc1271VerifierStub: SignatureVerifier = buildErc1271Verifier(null);

// ── LOCAL_FIXTURE test verifier ──────────────────────────────────────────────
// Accepts any signature for whitelisted sentinel test addresses.
// NEVER used in production — enforced by server.ts config check.
// Sentinels are test-only zero-prefixed addresses, not real wallets. // arc-studio-allow-onchain-literal

const LOCAL_FIXTURE_TEST_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000001", // arc-studio-allow-onchain-literal
  "0x0000000000000000000000000000000000000002", // arc-studio-allow-onchain-literal
  "0x0000000000000000000000000000000000000003", // arc-studio-allow-onchain-literal
]);

export const localFixtureVerifier: SignatureVerifier = {
  async verify(_message, _signature, address, _chainId): Promise<VerifyResult> {
    const lower = address.toLowerCase();
    if (LOCAL_FIXTURE_TEST_ADDRESSES.has(lower)) {
      return { ok: true, method: "ecdsa", recoveredAddress: lower as `0x${string}` };
    }
    return {
      ok:     false,
      reason: `LOCAL_FIXTURE: address ${address} not in test fixture set`,
    };
  },
};

// ── Challenge message builder ────────────────────────────────────────────────

export interface ChallengeParams {
  domain:    string;
  address:   string;
  chainId:   bigint;
  nonce:     string;
  issuedAt:  Date;
  expiresAt: Date;
  uri:       string;
}

/**
 * Build the canonical challenge message string.
 * Format is EIP-4361-inspired (Sign-In with Ethereum), simplified.
 *
 * CANONICAL CONTRACT: every field is deterministic given the stored challenge row.
 * The verify handler MUST reconstruct the message from the stored row fields
 * (origin, uri, issued_at, expires_at, domain, nonce, chain_id, address),
 * never from the incoming request. The wallet signed exactly this string.
 */
export function buildChallengeMessage(p: ChallengeParams): string {
  return [
    `${p.domain} wants you to sign in with your Ethereum account:`,
    // Match the canonical address persisted by the challenge repository.
    p.address.toLowerCase(),
    "",
    "URI: " + p.uri,
    "Version: 1",
    "Chain ID: " + p.chainId.toString(),
    "Nonce: " + p.nonce,
    "Issued At: " + p.issuedAt.toISOString(),
    "Expiration Time: " + p.expiresAt.toISOString(),
  ].join("\n");
}

// Suppress unused-import warning — hexToBytes is imported for callers
void hexToBytes;
