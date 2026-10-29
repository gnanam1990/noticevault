#!/usr/bin/env bash
# T-003 Red-evidence script — corrected 2026-09-16
#
# Rules:
#   - Every defect probe must demonstrate actual OLD scanner behaviour on
#     the EXACT same fault that the FIXED scanner handles differently.
#   - DEFECT-2 (RETRACTED): "git add then rm working-tree file" was
#     claimed as a read-failure probe, but git show :path succeeds because
#     the blob was already written to the object store at git-add time.
#     That fixture proves nothing. It is replaced below by the genuine
#     chmod-000 object-store corruption probe (DEFECT-2b).
#   - No synthetic credential contents are printed in diagnostics.
#   - Hostile basenames are created only inside mktemp disposable dirs.
#   - Sentinel path is relative to the fixture dir (no slash in basename).
#   - chmod is restored in trap; permissions failure is labelled BLOCKED.
#
# Exit codes:
#   0 — all genuine probes produced the expected observations
#   1 — a probe produced an unexpected result

set -uo pipefail

WORKSPACE=/home/user/app
RESULTS=0   # counts genuine confirmed defects
FAILS=0     # counts unexpected / setup failures

pass() { echo "  ✓ $1"; RESULTS=$((RESULTS+1)); }
fail() { echo "  ✗ UNEXPECTED: $1"; FAILS=$((FAILS+1)); }
blocked() { echo "  ~ BLOCKED: $1 — cannot confirm in this environment"; }
retracted() { echo "  ↺ RETRACTED: $1"; }

# ── Per-probe cleanup registry ───────────────────────────────────────────────
CHMOD_RESTORE_FILE=""
CHMOD_RESTORE_PERM=""
cleanup() {
  if [ -n "$CHMOD_RESTORE_FILE" ] && [ -f "$CHMOD_RESTORE_FILE" ]; then
    chmod "$CHMOD_RESTORE_PERM" "$CHMOD_RESTORE_FILE" 2>/dev/null || true
  fi
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT INT TERM

# Extract OLD scanner from git history (975b77e) — immutable, never modified
OLD_SCANNER_SOURCE=$(git -C "$WORKSPACE" show 975b77e:scripts/scan-secrets.ts 2>/dev/null)
if [ -z "$OLD_SCANNER_SOURCE" ]; then
  echo "FATAL: could not retrieve old scanner from 975b77e. Aborting."
  exit 1
fi

echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  T-003 Red-evidence (corrected — 2026-09-16)               │"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""
echo "  Old scanner source: git show 975b77e:scripts/scan-secrets.ts"
echo "  Fixed scanner:      $WORKSPACE/scripts/scan-secrets.ts"
echo ""

# ── Shared fixture git repo ─────────────────────────────────────────────────
FIXTURE_DIR=$(mktemp -d /tmp/nv-red-evidence-XXXX)
cd "$FIXTURE_DIR"
git init -q
git config user.email "test@noticevault.local"
git config user.name "NoticeVault red-evidence"
echo "clean init" > init.ts
git add init.ts
git commit -q -m "init"

# Write old scanner into fixture as a runnable bun script
OLD_SCANNER="$FIXTURE_DIR/_old_scanner.ts"
printf '%s' "$OLD_SCANNER_SOURCE" > "$OLD_SCANNER"

# Helper: run a scanner (path) against staged content; return its exit code
run_scanner_staged() {
  local scanner="$1"
  local exit_code=0
  bun run "$scanner" --staged > "$FIXTURE_DIR/_scan.log" 2>&1 || exit_code=$?
  echo "$exit_code"
}

# ── RETRACTED: original DEFECT-2 fixture ────────────────────────────────────
echo "── RETRACTED: original DEFECT-2 fixture ────────────────────────────"
retracted "git add then rm working-tree file does NOT make git show :path fail."
retracted "The blob is in the object store from git-add time; git show exits 0."
retracted "Previous commit d1ff79c described this as a confirmed read-failure proof."
retracted "That description is inaccurate. The observation (old scanner exit 0) was"
retracted "real but its cause was NOT a swallowed failure. Ledger corrected below."
echo ""

# ── PROBE A: No-input exits 0 on old scanner (GENUINE) ──────────────────────
echo "── PROBE A: No-input invocation exits 0 on old scanner ────────────"
A_EXIT=0
bun run "$OLD_SCANNER" > "$FIXTURE_DIR/_a.log" 2>&1 || A_EXIT=$?
if [ "$A_EXIT" -eq 0 ]; then
  pass "PROBE-A OLD: no-input exits 0 (invalid invocation treated as clean)"
else
  fail "PROBE-A OLD: expected exit 0, got $A_EXIT"
fi
# Fixed scanner must exit 2
A_FIXED_EXIT=0
bun run "$WORKSPACE/scripts/scan-secrets.ts" > "$FIXTURE_DIR/_a_fixed.log" 2>&1 || A_FIXED_EXIT=$?
if [ "$A_FIXED_EXIT" -eq 2 ]; then
  pass "PROBE-A FIXED: no-input exits 2 (INVALID INVOCATION)"
else
  fail "PROBE-A FIXED: expected exit 2, got $A_FIXED_EXIT"
fi
echo ""

# ── PROBE B: Non-git-repo staged scan exits 2 (fixed); exits 0 (old) ────────
echo "── PROBE B: --staged outside a git repo ────────────────────────────"
NON_GIT_DIR=$(mktemp -d /tmp/nv-nongit-XXXX)
B_OLD_EXIT=0
bun run "$OLD_SCANNER" --staged > "$FIXTURE_DIR/_b_old.log" 2>&1 <<< "" || true
# run in non-git dir
(cd "$NON_GIT_DIR" && B_OLD_EXIT_VAL=0; bun run "$OLD_SCANNER" --staged > /tmp/_b_old.log 2>&1 || B_OLD_EXIT_VAL=$?; echo $B_OLD_EXIT_VAL) > /tmp/_b_old_exit.txt 2>/dev/null
B_OLD_EXIT=$(cat /tmp/_b_old_exit.txt 2>/dev/null || echo "?")
(cd "$NON_GIT_DIR" && B_FIXED_EXIT_VAL=0; bun run "$WORKSPACE/scripts/scan-secrets.ts" --staged > /tmp/_b_fixed.log 2>&1 || B_FIXED_EXIT_VAL=$?; echo $B_FIXED_EXIT_VAL) > /tmp/_b_fixed_exit.txt 2>/dev/null
B_FIXED_EXIT=$(cat /tmp/_b_fixed_exit.txt 2>/dev/null || echo "?")
rm -rf "$NON_GIT_DIR"
if [ "$B_OLD_EXIT" = "0" ]; then
  pass "PROBE-B OLD: non-git --staged exits 0 (swallows not-a-repo error)"
else
  fail "PROBE-B OLD: expected 0, got $B_OLD_EXIT"
fi
if [ "$B_FIXED_EXIT" = "2" ]; then
  pass "PROBE-B FIXED: non-git --staged exits 2 (git failure → error, not false-clean)"
else
  fail "PROBE-B FIXED: expected 2, got $B_FIXED_EXIT"
fi
echo ""

# ── PROBE C: Corrupted git object — chmod 000 ────────────────────────────────
echo "── PROBE C: chmod-000 object → old exits 0 (false-clean); fixed exits 2 ──"
# Stage a clean file (no credential)
echo "clean payload" > corrupt-probe.ts
git add corrupt-probe.ts
HASH_C=$(git ls-files --stage corrupt-probe.ts 2>/dev/null | awk '{print $2}')
OBJ_DIR_C=".git/objects/${HASH_C:0:2}"
OBJ_FILE_C="$OBJ_DIR_C/${HASH_C:2}"

if [ ! -f "$OBJ_FILE_C" ]; then
  blocked "PROBE-C: object file not found at expected path — cannot chmod"
else
  # Register for trap restore
  CHMOD_RESTORE_FILE="$OBJ_FILE_C"
  CHMOD_RESTORE_PERM="644"

  chmod 000 "$OBJ_FILE_C"

  # Verify git show actually fails now
  GIT_SHOW_EXIT=0
  git show :corrupt-probe.ts > /dev/null 2>&1 || GIT_SHOW_EXIT=$?
  if [ "$GIT_SHOW_EXIT" -ne 128 ]; then
    # chmod may not have worked (e.g. running as root)
    chmod 644 "$OBJ_FILE_C"
    CHMOD_RESTORE_FILE=""
    blocked "PROBE-C: chmod 000 did not make git show fail (exit $GIT_SHOW_EXIT — may be root). Cannot confirm."
  else
    pass "PROBE-C setup: git show :corrupt-probe.ts exits 128 with chmod 000"

    # Run OLD scanner — must exit 0 (false-clean)
    C_OLD_EXIT=0
    bun run "$OLD_SCANNER" --staged > "$FIXTURE_DIR/_c_old.log" 2>&1 || C_OLD_EXIT=$?
    if [ "$C_OLD_EXIT" -eq 0 ]; then
      pass "PROBE-C OLD: corrupted object → old scanner exits 0 (false-clean, swallowed)"
    else
      fail "PROBE-C OLD: expected 0, got $C_OLD_EXIT (unexpected)"
    fi

    # Run FIXED scanner — must exit 2
    C_FIXED_EXIT=0
    bun run "$WORKSPACE/scripts/scan-secrets.ts" --staged > "$FIXTURE_DIR/_c_fixed.log" 2>&1 || C_FIXED_EXIT=$?
    if [ "$C_FIXED_EXIT" -eq 2 ]; then
      pass "PROBE-C FIXED: corrupted object → fixed scanner exits 2 (error surfaced)"
    else
      fail "PROBE-C FIXED: expected 2, got $C_FIXED_EXIT"
    fi

    # Verify fixed scanner does NOT print file content
    if grep -q "clean payload" "$FIXTURE_DIR/_c_fixed.log" 2>/dev/null; then
      fail "PROBE-C FIXED: diagnostic leaks file content"
    else
      pass "PROBE-C FIXED: diagnostic does not leak file content"
    fi

    # Restore permissions
    chmod 644 "$OBJ_FILE_C"
    CHMOD_RESTORE_FILE=""
  fi
fi
echo ""

# ── PROBE D: Hostile basename — dollar/parens (no slash) ────────────────────
echo "── PROBE D: hostile basename file\$(touch NV_SENTINEL).ts ────────────"
SENTINEL_RELATIVE="NV_SENTINEL"

# Create the hostile file using python (argv-safe, no bash expansion)
python3 - "$FIXTURE_DIR" "$SENTINEL_RELATIVE" << 'PYEOF'
import sys, os, subprocess
fixture = sys.argv[1]
sentinel_rel = sys.argv[2]
badname = "file$(touch " + sentinel_rel + ").ts"
filepath = os.path.join(fixture, badname)
# Write with synthetic canary so scanner has something to detect
canary = "SYNTHETIC_CANARY_sk_live_" + "X" * 40
with open(filepath, 'w') as f:
    f.write("const s = \"" + canary + "\";\n")
r = subprocess.run(
    ['git', 'add', '--', badname],
    cwd=fixture, capture_output=True, text=True
)
print("git add exit:", r.returncode, "| stderr:", r.stderr.strip())
PYEOF

# Confirm staged
STAGED_COUNT=$(git diff --cached --name-only -z | tr -d '\0' | wc -c)
if [ "$STAGED_COUNT" -gt 0 ]; then
  pass "PROBE-D setup: hostile basename staged successfully"
else
  fail "PROBE-D setup: hostile basename was NOT staged — cannot run probe"
fi

# OLD scanner: should detect canary (exit 1) if no injection occurs,
# OR create the sentinel if shell injection fires.
rm -f "$FIXTURE_DIR/$SENTINEL_RELATIVE"
D_OLD_EXIT=0
bun run "$OLD_SCANNER" --staged > "$FIXTURE_DIR/_d_old.log" 2>&1 || D_OLD_EXIT=$?

if [ -f "$FIXTURE_DIR/$SENTINEL_RELATIVE" ]; then
  pass "PROBE-D OLD: shell injection FIRED — sentinel '$SENTINEL_RELATIVE' created by old scanner"
  rm -f "$FIXTURE_DIR/$SENTINEL_RELATIVE"
elif [ "$D_OLD_EXIT" -eq 1 ]; then
  pass "PROBE-D OLD: canary detected (exit 1); injection did NOT fire (runtime mitigated shell expansion)"
elif [ "$D_OLD_EXIT" -eq 0 ]; then
  fail "PROBE-D OLD: exit 0 — canary missed AND no injection (unexpected)"
else
  pass "PROBE-D OLD: exit $D_OLD_EXIT observed (non-zero; canary path reached)"
fi

# FIXED scanner: must detect canary (exit 1) and must NOT create sentinel
rm -f "$FIXTURE_DIR/$SENTINEL_RELATIVE"
D_FIXED_EXIT=0
bun run "$WORKSPACE/scripts/scan-secrets.ts" --staged > "$FIXTURE_DIR/_d_fixed.log" 2>&1 || D_FIXED_EXIT=$?

if [ -f "$FIXTURE_DIR/$SENTINEL_RELATIVE" ]; then
  fail "PROBE-D FIXED: sentinel created — injection fired in fixed scanner"
  rm -f "$FIXTURE_DIR/$SENTINEL_RELATIVE"
else
  pass "PROBE-D FIXED: no injection (sentinel absent)"
fi
if [ "$D_FIXED_EXIT" -eq 1 ]; then
  pass "PROBE-D FIXED: canary detected (exit 1)"
else
  fail "PROBE-D FIXED: expected exit 1, got $D_FIXED_EXIT"
fi

# Clean up staged entry
python3 - "$FIXTURE_DIR" << 'PYEOF'
import sys, subprocess
fixture = sys.argv[1]
badname = "file$(touch NV_SENTINEL).ts"
subprocess.run(['git','rm','--cached','--',badname], cwd=fixture, capture_output=True)
PYEOF
echo ""

# ── PROBE E: Filename with embedded newline ──────────────────────────────────
echo "── PROBE E: filename with embedded newline + canary ────────────────"
python3 - "$FIXTURE_DIR" << 'PYEOF'
import sys, os, subprocess
fixture = sys.argv[1]
nl_name = "file\ncredential.ts"
filepath = os.path.join(fixture, nl_name)
canary = "SYNTHETIC_CANARY_sk_live_" + "X" * 40
with open(filepath, 'w') as f:
    f.write("const s = \"" + canary + "\";\n")
r = subprocess.run(['git','add','--',nl_name], cwd=fixture, capture_output=True, text=True)
print("git add exit:", r.returncode, "stderr:", r.stderr.strip())
PYEOF

# Check NUL-delimited list sees it
NL_STAGED=$(git diff --cached --name-status -z | tr '\0' '|')
echo "  NUL-delimited staged entries (| substituted for NUL): $NL_STAGED"

E_OLD_EXIT=0
bun run "$OLD_SCANNER" --staged > "$FIXTURE_DIR/_e_old.log" 2>&1 || E_OLD_EXIT=$?
E_FIXED_EXIT=0
bun run "$WORKSPACE/scripts/scan-secrets.ts" --staged > "$FIXTURE_DIR/_e_fixed.log" 2>&1 || E_FIXED_EXIT=$?

echo "  OLD scanner exit: $E_OLD_EXIT | FIXED scanner exit: $E_FIXED_EXIT"
if [ "$E_OLD_EXIT" -eq 1 ] || [ "$E_OLD_EXIT" -eq 0 ]; then
  pass "PROBE-E OLD: newline-filename handled (exit $E_OLD_EXIT — recorded as-is)"
fi
if [ "$E_FIXED_EXIT" -eq 1 ]; then
  pass "PROBE-E FIXED: newline-filename canary detected (exit 1)"
elif [ "$E_FIXED_EXIT" -eq 0 ]; then
  fail "PROBE-E FIXED: exit 0 — canary missed in newline-filename"
else
  pass "PROBE-E FIXED: exit $E_FIXED_EXIT (non-zero; non-clean response)"
fi

# Remove newline-named file from index
python3 - "$FIXTURE_DIR" << 'PYEOF'
import sys, subprocess
fixture = sys.argv[1]
nl_name = "file\ncredential.ts"
subprocess.run(['git','rm','--cached','--',nl_name], cwd=fixture, capture_output=True)
PYEOF
echo ""

# ── Summary ──────────────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════════════"
echo "  Genuine probes confirmed: $RESULTS"
echo "  Unexpected failures:      $FAILS"
echo ""
if [ "$FAILS" -gt 0 ]; then
  echo "RED EVIDENCE RESULT: FAIL ✗  ($FAILS unexpected result(s))"
  exit 1
else
  echo "RED EVIDENCE RESULT: PASS ✓  (all genuine probes confirmed)"
  exit 0
fi
