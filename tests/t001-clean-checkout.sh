#!/usr/bin/env bash
# T-001: Clean checkout setup proof
# Demonstrates: (1) absent/broken state, (2) dependency setup works,
# (3) quality commands pass from a clean-ish copy.
# Uses an isolated temp dir so the real workspace is never touched.

set -euo pipefail

WORKSPACE=/home/user/app
FIXTURE_DIR=/tmp/nv-t001-$$
EXIT_CODE=0

cleanup() { rm -rf "$FIXTURE_DIR"; }
trap cleanup EXIT

echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  T-001: Clean checkout setup                                │"
echo "└─────────────────────────────────────────────────────────────┘"

# Step 1: Create isolated copy of just the packages/domain source
mkdir -p "$FIXTURE_DIR/packages/domain/src"
cp "$WORKSPACE/packages/domain/package.json"   "$FIXTURE_DIR/packages/domain/"
cp "$WORKSPACE/packages/domain/tsconfig.json"  "$FIXTURE_DIR/packages/domain/"
cp "$WORKSPACE/packages/domain/src/index.ts"   "$FIXTURE_DIR/packages/domain/src/"
cp "$WORKSPACE/packages/domain/src/m00-foundation.test.ts" "$FIXTURE_DIR/packages/domain/src/"

# Step 2: Show absent state — no node_modules yet
echo ""
echo "[1/4] Confirming absent state (no node_modules in fixture)..."
if [ -d "$FIXTURE_DIR/packages/domain/node_modules" ]; then
  echo "  ✗ node_modules already present — fixture not clean"
  EXIT_CODE=1
else
  echo "  ✓ node_modules absent — clean state confirmed"
fi

# Step 3: Install dependencies
echo ""
echo "[2/4] Installing dependencies in fixture..."
cd "$FIXTURE_DIR/packages/domain"
if bun install > /tmp/nv-t001-install.log 2>&1; then
  echo "  ✓ bun install succeeded (exit 0)"
  echo "  Packages installed: $(ls node_modules | wc -l | tr -d ' ')"
else
  echo "  ✗ bun install failed (exit $?)"
  cat /tmp/nv-t001-install.log
  EXIT_CODE=1
fi

# Step 4: Run quality commands
echo ""
echo "[3/4] Running type check..."
if bun run check > /tmp/nv-t001-check.log 2>&1; then
  echo "  ✓ typecheck passed (exit 0)"
else
  echo "  ✗ typecheck failed (exit $?)"
  cat /tmp/nv-t001-check.log
  EXIT_CODE=1
fi

echo ""
echo "[4/4] Running unit tests..."
if bun run test > /tmp/nv-t001-test.log 2>&1; then
  echo "  ✓ vitest passed (exit 0)"
  grep -E "Tests|pass|fail" /tmp/nv-t001-test.log | head -5 || true
else
  echo "  ✗ vitest failed (exit $?)"
  cat /tmp/nv-t001-test.log
  EXIT_CODE=1
fi

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "T-001 RESULT: PASS ✓  (exit 0)"
else
  echo "T-001 RESULT: FAIL ✗  (exit $EXIT_CODE)"
fi

exit "$EXIT_CODE"
