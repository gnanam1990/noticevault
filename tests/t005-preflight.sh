#!/usr/bin/env bash
# T-005: External action preflight
# Proves the preflight script stops before the broadcast boundary.
# Tests three scenarios:
#   A. LOCAL_FIXTURE identity → pass, broadcast blocked
#   B. ARC_MAINNET without ENABLE_MAINNET → fail, broadcast blocked
#   C. ARC_MAINNET with ENABLE_MAINNET=true → fail (still blocked, requires manual steps)
# Never sends a transaction or calls any RPC to test the guard.

set -euo pipefail

WORKSPACE=/home/user/app
EXIT_CODE=0

echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  T-005: External action preflight guard                    │"
echo "└─────────────────────────────────────────────────────────────┘"

run_preflight() {
  local label="$1"
  shift
  local expect_exit="$1"
  shift
  # remaining args are env vars
  echo ""
  echo "Scenario: $label"
  local actual_exit=0
  env "$@" bun run "$WORKSPACE/scripts/preflight.ts" > /tmp/nv-t005-out.log 2>&1 || actual_exit=$?
  echo "  Expected exit: $expect_exit  |  Actual exit: $actual_exit"

  # Check broadcast was not allowed
  if grep -q "Broadcast boundary.*was NOT called" /tmp/nv-t005-out.log; then
    echo "  ✓ Broadcast boundary NOT called"
  else
    echo "  ✗ Broadcast boundary check missing from output"
    EXIT_CODE=1
  fi

  if [ "$actual_exit" -eq "$expect_exit" ]; then
    echo "  ✓ Exit code matches expectation"
  else
    echo "  ✗ Exit code mismatch (expected $expect_exit got $actual_exit)"
    EXIT_CODE=1
    cat /tmp/nv-t005-out.log
  fi

  # Show key lines
  grep -E "Identity|Status|MAINNET_GUARD|BLOCK|PASS|FAIL|Warning" /tmp/nv-t005-out.log | head -8 || true
}

# Scenario A: LOCAL_FIXTURE — should pass (exit 0)
run_preflight "LOCAL_FIXTURE — expect PASS (exit 0)" 0 \
  CONFIG_IDENTITY=LOCAL_FIXTURE \
  ENABLE_MAINNET=false

# Scenario B: ARC_MAINNET without flag — should fail (exit 1)
run_preflight "ARC_MAINNET without ENABLE_MAINNET — expect FAIL (exit 1)" 1 \
  CONFIG_IDENTITY=ARC_MAINNET \
  ENABLE_MAINNET=false

# Scenario C: ARC_MAINNET with flag — should still fail (exit 1, requires manual steps)
run_preflight "ARC_MAINNET with ENABLE_MAINNET=true — expect FAIL (exit 1, manual steps required)" 1 \
  CONFIG_IDENTITY=ARC_MAINNET \
  ENABLE_MAINNET=true

# Scenario D: ARC_TESTNET with correct config — should pass (exit 0)
run_preflight "ARC_TESTNET with correct config — expect PASS (exit 0)" 0 \
  CONFIG_IDENTITY=ARC_TESTNET \
  ENABLE_MAINNET=false \
  VITE_ARC_TESTNET_CHAIN_ID=5042002 \
  VITE_USDC_ARC_TESTNET=0x3600000000000000000000000000000000000000

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "T-005 RESULT: PASS ✓  (exit 0 — preflight stops before broadcast in all scenarios)"
else
  echo "T-005 RESULT: FAIL ✗  (exit $EXIT_CODE)"
fi

exit "$EXIT_CODE"
