#!/usr/bin/env bash
# T-004: Quality commands detect defects
# Introduces a failing test in an isolated copy.
# Captures actual failure output (RED), then fixes it and captures pass (GREEN).
# Proves the runner catches failures — not a skipped suite or swallowed exit code.

set -euo pipefail

WORKSPACE=/home/user/app
FIXTURE_DIR=/tmp/nv-t004-$$
EXIT_CODE=0

cleanup() { rm -rf "$FIXTURE_DIR"; }
trap cleanup EXIT

echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  T-004: Quality commands detect defects                    │"
echo "└─────────────────────────────────────────────────────────────┘"

# Copy domain package to fixture
mkdir -p "$FIXTURE_DIR/src"
cp "$WORKSPACE/packages/domain/package.json"  "$FIXTURE_DIR/"
cp "$WORKSPACE/packages/domain/tsconfig.json" "$FIXTURE_DIR/"
cp "$WORKSPACE/packages/domain/src/index.ts"  "$FIXTURE_DIR/src/"

# Install vitest in the fixture (reuse workspace cache)
echo ""
echo "[1/5] Setting up fixture with installed vitest..."
cd "$FIXTURE_DIR"
bun install > /tmp/nv-t004-install.log 2>&1
echo "  ✓ bun install complete"

# Write a FAILING test
echo ""
echo "[2/5] Writing deliberately failing test..."
cat > "$FIXTURE_DIR/src/failing.test.ts" << 'TESTEOF'
import { describe, it, expect } from "vitest";
describe("T-004 deliberate failure", () => {
  it("INTENTIONAL FAIL: 1 + 1 should equal 3 (wrong)", () => {
    expect(1 + 1).toBe(3); // ← deliberately wrong
  });
});
TESTEOF
echo "  Failing test written: expect(1+1).toBe(3)"

echo ""
echo "[3/5] Running vitest — MUST fail (exit != 0)..."
FAIL_EXIT=0
bun run test > /tmp/nv-t004-fail.log 2>&1 || FAIL_EXIT=$?

echo "  vitest exit code: $FAIL_EXIT"
if [ "$FAIL_EXIT" -ne 0 ]; then
  echo "  ✓ Test runner caught the failure (exit $FAIL_EXIT) — RED confirmed"
  grep -E "FAIL|AssertionError|Expected|✗|×" /tmp/nv-t004-fail.log | head -6 || true
else
  echo "  ✗ Test runner did NOT fail (exit 0) — swallowed failure!"
  cat /tmp/nv-t004-fail.log
  EXIT_CODE=1
fi

# Fix the failing test
echo ""
echo "[4/5] Fixing the deliberate failure..."
cat > "$FIXTURE_DIR/src/failing.test.ts" << 'TESTEOF'
import { describe, it, expect } from "vitest";
describe("T-004 fixed test", () => {
  it("1 + 1 equals 2 (correct)", () => {
    expect(1 + 1).toBe(2);
  });
  it("bigint ceiling division works", () => {
    const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
    expect(ceilDiv(7n, 3n)).toBe(3n);
    expect(ceilDiv(6n, 3n)).toBe(2n);
  });
});
TESTEOF
echo "  Fixed test written: expect(1+1).toBe(2)"

echo ""
echo "[5/5] Running vitest — MUST pass (exit 0)..."
PASS_EXIT=0
bun run test > /tmp/nv-t004-pass.log 2>&1 || PASS_EXIT=$?

echo "  vitest exit code: $PASS_EXIT"
if [ "$PASS_EXIT" -eq 0 ]; then
  echo "  ✓ Test runner passed (exit 0) — GREEN confirmed"
  grep -E "Tests|pass|✓|✔" /tmp/nv-t004-pass.log | head -6 || true
else
  echo "  ✗ Test runner failed after fix (exit $PASS_EXIT)"
  cat /tmp/nv-t004-pass.log
  EXIT_CODE=1
fi

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "T-004 RESULT: PASS ✓  (exit 0 — genuine red/green cycle proven)"
else
  echo "T-004 RESULT: FAIL ✗  (exit $EXIT_CODE)"
fi

exit "$EXIT_CODE"
