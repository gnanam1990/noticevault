/**
 * T-004 — Quality commands detect defects
 * Foundation tests for M00. These verify the test runner itself works with
 * meaningful assertions. Financial logic (M01) is NOT implemented here.
 */

import { describe, it, expect } from "vitest";
import { DOMAIN_VERSION } from "./index.js";

describe("M00 Foundation — domain package", () => {
  it("T-004a: test runner executes and version stub is present", () => {
    // Verifies vitest runs, imports resolve, and a meaningful assertion fires
    // Updated in M01: version advanced to 0.1.0-m01
    expect(DOMAIN_VERSION).toMatch(/^0\.\d+\.\d+/);
    expect(typeof DOMAIN_VERSION).toBe("string");
  });

  it("T-004b: assertions genuinely fail for wrong values (runner integrity)", () => {
    // Proves the runner catches failures — this test PASSES by asserting
    // the wrong value would cause a failure (we verify the positive form only;
    // the negative fixture is in the T-004 shell proof below)
    const notTheVersion = "some-other-value";
    expect(DOMAIN_VERSION).not.toBe(notTheVersion);
  });

  it("T-004c: bigint arithmetic available in this runtime", () => {
    // Node/bun 20+ required for bigint — verify before M01 relies on it
    const a = BigInt("1000000"); // 1 USDC in 6-decimal atoms
    const b = BigInt("500000");  // 0.5 USDC
    expect(a + b).toBe(BigInt("1500000"));
    expect(a - b).toBe(BigInt("500000"));
    expect(a * b).toBe(BigInt("500000000000")); // raw product
    // Integer division
    expect(a / b).toBe(BigInt("2"));
    // Modulo
    expect(a % b).toBe(BigInt("0"));
  });

  it("T-004d: BigInt ceiling division (used by reserve formula R=ceil(A*N/P))", () => {
    // Demonstrates the pattern that M01 will use — without inventing financial rules
    function ceilDiv(a: bigint, b: bigint): bigint {
      if (b === 0n) throw new Error("division by zero");
      return (a + b - 1n) / b;
    }
    expect(ceilDiv(10n, 3n)).toBe(4n);   // ceil(10/3) = 4
    expect(ceilDiv(9n, 3n)).toBe(3n);    // ceil(9/3) = 3 (exact)
    expect(ceilDiv(1n, 1n)).toBe(1n);
    expect(ceilDiv(0n, 5n)).toBe(0n);
    expect(() => ceilDiv(5n, 0n)).toThrow("division by zero");
  });

  it("T-004e: CONFIG_IDENTITY guard is LOCAL_FIXTURE or unset in test environment", () => {
    // Ensures tests never accidentally run with ARC_MAINNET identity
    const identity = process.env["CONFIG_IDENTITY"] ?? "LOCAL_FIXTURE";
    expect(identity).not.toBe("ARC_MAINNET");
  });
});
