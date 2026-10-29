/**
 * @noticevault/domain — bigint math helpers
 *
 * All operations on uint256/int64 values.
 * No Number/float. Full-precision bigint intermediates.
 * Helpers throw ArithmeticError on invalid inputs.
 */

import { ArithmeticError, UINT256_MAX, INT64_MAX } from "./types.js";

// ── Guards ────────────────────────────────────────────────────────────────────

export function assertNonNegative(n: bigint, label: string): void {
  if (n < 0n) throw new ArithmeticError(`${label} must be >= 0, got ${n}`);
}

export function assertPositiveDivisor(d: bigint, label: string): void {
  if (d <= 0n) throw new ArithmeticError(`${label} must be > 0, got ${d}`);
}

export function assertUint256(n: bigint, label: string): void {
  if (n < 0n || n > UINT256_MAX)
    throw new ArithmeticError(`${label} overflows uint256: ${n}`);
}

export function assertInt64(n: bigint, label: string): void {
  if (n < 0n || n > INT64_MAX)
    throw new ArithmeticError(`${label} overflows int64 (signed): ${n}`);
}

// ── Floor and ceiling integer division ───────────────────────────────────────

/**
 * Floor division: floor(a / b).
 * Requires a >= 0, b > 0.
 */
export function floorDiv(a: bigint, b: bigint): bigint {
  assertNonNegative(a, "floorDiv: a");
  assertPositiveDivisor(b, "floorDiv: b");
  return a / b; // bigint division truncates toward zero = floor for non-negative
}

/**
 * Ceiling division: ceil(a / b).
 * Requires a >= 0, b > 0.
 */
export function ceilDiv(a: bigint, b: bigint): bigint {
  assertNonNegative(a, "ceilDiv: a");
  assertPositiveDivisor(b, "ceilDiv: b");
  return (a + b - 1n) / b;
}

// ── Full-precision mul-then-div ───────────────────────────────────────────────

/**
 * mulDivFloor(a, b, c) = floor(a * b / c)
 * Full-precision bigint intermediate — may exceed 256 bits.
 * Final result must fit in uint256 for the caller to persist.
 */
export function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint {
  assertNonNegative(a, "mulDivFloor: a");
  assertNonNegative(b, "mulDivFloor: b");
  assertPositiveDivisor(c, "mulDivFloor: c");
  return (a * b) / c;
}

/**
 * mulDivCeil(a, b, c) = ceil(a * b / c)
 * Full-precision bigint intermediate.
 */
export function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint {
  assertNonNegative(a, "mulDivCeil: a");
  assertNonNegative(b, "mulDivCeil: b");
  assertPositiveDivisor(c, "mulDivCeil: c");
  return (a * b + c - 1n) / c;
}

// ── Clamp and min/max ─────────────────────────────────────────────────────────

export function clamp(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function bigMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function bigMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

// ── Safe arithmetic ───────────────────────────────────────────────────────────

/**
 * safeSub: a - b, throws if b > a (no underflow).
 */
export function safeSub(a: bigint, b: bigint, label: string): bigint {
  if (b > a)
    throw new ArithmeticError(`${label}: underflow: ${a} - ${b} < 0`);
  return a - b;
}

/**
 * safeAddUint256: a + b, throws if result > UINT256_MAX.
 */
export function safeAddUint256(a: bigint, b: bigint, label: string): bigint {
  const result = a + b;
  if (result > UINT256_MAX)
    throw new ArithmeticError(`${label}: overflow uint256: ${a} + ${b}`);
  return result;
}
