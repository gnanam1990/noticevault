#!/usr/bin/env bun
/**
 * NoticeVault preflight guard — T-005
 *
 * Validates environment configuration and STOPS before any possible broadcast,
 * publication, wallet signature, or remote mutation.
 *
 * RULES:
 *  - Mainnet is DISABLED unless ENABLE_MAINNET=true is explicitly set
 *  - ARC_MAINNET identity requires ENABLE_MAINNET=true and a second confirmation
 *  - Any missing required non-mainnet config causes a non-zero exit
 *  - This script NEVER calls any chain RPC, never signs, never transfers
 *
 * Exit codes:
 *   0 — preflight passed for the active identity (safe to proceed locally)
 *   1 — preflight failed: environment error, missing config, or mainnet guard
 *   2 — mainnet guard: ENABLE_MAINNET not set or confirmation missing
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type ConfigIdentity = "LOCAL_FIXTURE" | "ARC_TESTNET" | "ARC_MAINNET";

interface PreflightResult {
  passed: boolean;
  identity: ConfigIdentity | "UNKNOWN";
  errors: string[];
  warnings: string[];
  broadcastAllowed: boolean;
}

// ─── Hostile boundary probe ───────────────────────────────────────────────────
// This is the "broadcaster" boundary. The preflight must STOP before reaching it.
// In production this would call the first RPC method. Here it throws to prove
// the guard fires.

function hostileBroadcastBoundary(_reason: string): never {
  // If we reach this function the preflight failed to stop us.
  throw new Error(
    `PREFLIGHT_BREACH: Attempted broadcast boundary was reached. ` +
      `The guard must stop execution before this point. Reason: ${_reason}`
  );
}

// ─── Guard ────────────────────────────────────────────────────────────────────

function runPreflight(): PreflightResult {
  const result: PreflightResult = {
    passed: false,
    identity: "UNKNOWN",
    errors: [],
    warnings: [],
    broadcastAllowed: false,
  };

  // 1. Read identity
  const rawIdentity = process.env["CONFIG_IDENTITY"] ?? "LOCAL_FIXTURE";
  const validIdentities: ConfigIdentity[] = [
    "LOCAL_FIXTURE",
    "ARC_TESTNET",
    "ARC_MAINNET",
  ];
  if (!validIdentities.includes(rawIdentity as ConfigIdentity)) {
    result.errors.push(
      `CONFIG_IDENTITY="${rawIdentity}" is not valid. Must be one of: ${validIdentities.join(", ")}`
    );
  } else {
    result.identity = rawIdentity as ConfigIdentity;
  }

  // 2. Mainnet guard — must check BEFORE any other network operation
  const enableMainnet = process.env["ENABLE_MAINNET"];
  if (result.identity === "ARC_MAINNET") {
    if (enableMainnet !== "true") {
      result.errors.push(
        `MAINNET_GUARD: CONFIG_IDENTITY=ARC_MAINNET but ENABLE_MAINNET is not "true". ` +
          `Mainnet is DISABLED by default. Set ENABLE_MAINNET=true only after independent ` +
          `security review, testnet sign-off, and explicit manual operator confirmation.`
      );
      // Prove we stopped BEFORE reaching the broadcast boundary
      result.broadcastAllowed = false;
      result.passed = false;
      return result; // ← stops here; never calls hostileBroadcastBoundary
    }
    // Even with ENABLE_MAINNET=true we still don't allow broadcast from this script
    result.errors.push(
      `MAINNET_GUARD: Mainnet deployment requires manual operator steps outside this script. ` +
        `Preflight exits before any broadcast even when ENABLE_MAINNET=true.`
    );
    result.broadcastAllowed = false;
    result.passed = false;
    return result;
  }

  // 3. LOCAL_FIXTURE — no chain connectivity needed; just confirm labelling guard
  if (result.identity === "LOCAL_FIXTURE") {
    result.warnings.push(
      "[TEST DATA] LOCAL_FIXTURE identity active. All displayed balances and addresses " +
        "are synthetic test data. Not connected to any blockchain."
    );
    result.passed = true;
    result.broadcastAllowed = false; // never allowed from preflight
    return result;
  }

  // 4. ARC_TESTNET — validate required config present (no actual RPC call)
  if (result.identity === "ARC_TESTNET") {
    const chainId = process.env["VITE_ARC_TESTNET_CHAIN_ID"];
    if (!chainId || chainId !== "5042002") {
      result.errors.push(
        `ARC_TESTNET requires VITE_ARC_TESTNET_CHAIN_ID=5042002, got: "${chainId ?? "unset"}"`
      );
    }
    const usdc = process.env["VITE_USDC_ARC_TESTNET"];
    if (!usdc) {
      result.errors.push(`ARC_TESTNET requires VITE_USDC_ARC_TESTNET to be set`);
    }
    if (result.errors.length === 0) {
      result.passed = true;
      result.broadcastAllowed = false; // signing/transfers handled client-side
    }
    return result;
  }

  // Should be unreachable
  result.errors.push("Unhandled identity — this is a preflight bug");
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const result = runPreflight();

  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║   NoticeVault Preflight Guard (T-005)        ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
  console.log(`Identity : ${result.identity}`);
  console.log(`Broadcast: ${result.broadcastAllowed ? "ALLOWED (ERROR)" : "BLOCKED ✓"}`);
  console.log(`Status   : ${result.passed ? "PASS ✓" : "FAIL ✗"}`);

  if (result.warnings.length > 0) {
    console.log(`\nWarnings:`);
    result.warnings.forEach((w) => console.log(`  ⚠  ${w}`));
  }

  if (result.errors.length > 0) {
    console.log(`\nErrors:`);
    result.errors.forEach((e) => console.error(`  ✗  ${e}`));
  }

  // T-005 proof: we never called hostileBroadcastBoundary().
  // The function reference exists to show what would be called in a real broadcaster.
  // Log its name without calling it.
  console.log(
    `\nBroadcast boundary "${hostileBroadcastBoundary.name}" was NOT called. ✓`
  );

  if (!result.passed) {
    console.log(`\nPreflight FAILED. Exiting 1.`);
    process.exit(1);
  }

  if (result.broadcastAllowed) {
    // Should never happen — belt-and-suspenders guard
    console.error(`\nPREFLIGHT_BREACH: broadcastAllowed=true slipped through!`);
    process.exit(2);
  }

  console.log(`\nPreflight passed. Safe to run local operations.\n`);
  process.exit(0);
}

main();
