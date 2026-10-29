#!/usr/bin/env bash
# =============================================================================
# t012-solidity-mutation-adequacy.sh  —  M02 Solidity mutation harness
#
# Strategy: in-tree source mutation, Python exact-string replacement via
#   temp files (avoids shell quoting of multi-line strings in heredocs).
#   One file mutated at a time. Backup saved before; EXIT trap restores.
#   Fails closed if old string not found exactly once.
#
# Mutants:
#   M1 NoticeVaultMath.sol    — ceil(A*N/P) → floor
#   M2 NoticeVaultAgreement   — derived _resolveNotice: S=D → S=now_
#   M3 NoticeVaultAgreement   — claimProvider: omit releaseCapacity
#   M4 NoticeVaultFactory     — TYPEHASH: drop amountPerPeriod field
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

HEAD=$(cd "$ROOT" && git rev-parse HEAD)
echo "M02 Solidity mutation harness — HEAD $HEAD"
echo ""

# ── Backup/restore ─────────────────────────────────────────────────────────
BACKUP_SRC=""
BACKUP_DEST=""
restore_backup() {
    if [[ -n "$BACKUP_DEST" && -f "$BACKUP_DEST" ]]; then
        cp "$BACKUP_DEST" "$BACKUP_SRC"
        rm -f "$BACKUP_DEST"
        BACKUP_DEST=""; BACKUP_SRC=""
    fi
}
trap 'restore_backup' EXIT

save_backup() {
    BACKUP_SRC="$1"
    BACKUP_DEST="${1}.bak_$$"
    cp "$1" "$BACKUP_DEST"
}

# Apply mutation via Python temp-file approach.
# $1=source file  $2=old-string file  $3=new-string file
mutate_files() {
    local src="$1" old_f="$2" new_f="$3"
    python3 - "$src" "$old_f" "$new_f" << 'PY'
import sys, pathlib
src_p = pathlib.Path(sys.argv[1])
src   = src_p.read_text()
old   = pathlib.Path(sys.argv[2]).read_text()
new   = pathlib.Path(sys.argv[3]).read_text()
count = src.count(old)
if count != 1:
    print(f"BLOCKED: expected 1 occurrence, found {count} in {sys.argv[1]}", file=sys.stderr)
    sys.exit(1)
src_p.write_text(src.replace(old, new, 1))
print("  Mutation applied (1 occurrence replaced).")
PY
}

run_forge() {
    local logfile="$1"; shift
    cd "$ROOT" && forge test "$@" > "$logfile" 2>&1
}
count_fail() { grep -c "^\[FAIL" "$1" 2>/dev/null || true; }
first_fail()  { grep "^\[FAIL" "$1" 2>/dev/null | head -1 | sed 's/\[FAIL[^]]*\] //' | awk '{print $1}' || true; }

# ── Baseline ──────────────────────────────────────────────────────────────
echo "=== Baseline: 80/80 must pass ==="
BL_LOG="/tmp/mut-bl-$$.log"
set +e; run_forge "$BL_LOG"; BL_EXIT=$?; set -e
BL_FAIL=$(count_fail "$BL_LOG")
if [[ "$BL_EXIT" -ne 0 || "$BL_FAIL" -ne 0 ]]; then
    echo "[BLOCKED] Baseline failed (exit=$BL_EXIT, fail=$BL_FAIL)."
    tail -10 "$BL_LOG"; exit 1
fi
BL_COUNT=$(grep -oE "[0-9]+ tests passed" "$BL_LOG" | awk '{sum+=$1} END{print sum}')
echo "[PASS] Baseline ${BL_COUNT} tests, 0 failures"
echo ""

# ══════════════════════════════════════════════════════════════════════════
# MUTANT 1: R ceil → floor
#
# NoticeVaultMath.sol::computeR
#   OLD: uint256 num = A * uint256(N) + uint256(P) - 1;
#   NEW: uint256 num = A * uint256(N);
#
# Kill: test_T016_10_R_ceil_non_divisible (A=7_000_003, N=10800, P=18000)
#   ceil=4_200_002, floor=4_200_001 → assertEq fails with mutant.
# ══════════════════════════════════════════════════════════════════════════
echo "=== Mutant 1: R ceil → floor ==="
MATH="$ROOT/contracts/src/NoticeVaultMath.sol"
M1_OLD_F="/tmp/m1_old_$$.txt"
M1_NEW_F="/tmp/m1_new_$$.txt"
printf '%s' '        uint256 num = A * uint256(N) + uint256(P) - 1;' > "$M1_OLD_F"
printf '%s' '        uint256 num = A * uint256(N); // MUTANT1: floor' > "$M1_NEW_F"

save_backup "$MATH"
if ! mutate_files "$MATH" "$M1_OLD_F" "$M1_NEW_F"; then
    echo "[BLOCKED] Mutant 1: exact string not found."; restore_backup; exit 1
fi

M1_LOG="/tmp/mut1-$$.log"
set +e
run_forge "$M1_LOG" --match-test "test_T016_10_R_ceil_non_divisible"
M1_EXIT=$?; set -e
M1_FAIL=$(count_fail "$M1_LOG")
restore_backup; rm -f "$M1_OLD_F" "$M1_NEW_F"

if [[ "$M1_FAIL" -gt 0 || "$M1_EXIT" -ne 0 ]]; then
    echo "[KILLED] Mutant 1 killed by: $(first_fail "$M1_LOG") (${M1_FAIL} failure(s))"
    PASS=$((PASS+1))
else
    echo "[SURVIVED] Mutant 1 NOT killed."
    FAIL=$((FAIL+1))
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════
# MUTANT 2: Derived _resolveNotice S=D → S=now_
#
# NoticeVaultAgreement.sol::_resolveNotice (view helper)
#   OLD: return (true, D_, REASON_MISSED_CHECKPOINT);
#   NEW: return (true, now_, REASON_MISSED_CHECKPOINT);
#
# Kill: test_T012_H_G2_day40_derived_notice calls preview() at day40.
#   preview → _resolveNotice → mutant returns S=now_=t0+40d.
#   Test asserts p.S == D_ == t0+30d → FAIL: "S=D (derived): X != Y".
# ══════════════════════════════════════════════════════════════════════════
echo "=== Mutant 2: Derived S=D → S=now_ ==="
AGR="$ROOT/contracts/src/NoticeVaultAgreement.sol"
M2_OLD_F="/tmp/m2_old_$$.txt"
M2_NEW_F="/tmp/m2_new_$$.txt"
printf '%s' '            return (true, D_, REASON_MISSED_CHECKPOINT);' > "$M2_OLD_F"
printf '%s' '            return (true, now_, REASON_MISSED_CHECKPOINT); // MUTANT2' > "$M2_NEW_F"

save_backup "$AGR"
if ! mutate_files "$AGR" "$M2_OLD_F" "$M2_NEW_F"; then
    echo "[BLOCKED] Mutant 2: exact string not found."; restore_backup; exit 1
fi

M2_LOG="/tmp/mut2-$$.log"
set +e
run_forge "$M2_LOG" --match-test "test_T012_H_G2_day40_derived_notice"
M2_EXIT=$?; set -e
M2_FAIL=$(count_fail "$M2_LOG")
restore_backup; rm -f "$M2_OLD_F" "$M2_NEW_F"

if [[ "$M2_FAIL" -gt 0 || "$M2_EXIT" -ne 0 ]]; then
    echo "[KILLED] Mutant 2 killed by: $(first_fail "$M2_LOG") (${M2_FAIL} failure(s))"
    PASS=$((PASS+1))
else
    echo "[SURVIVED] Mutant 2 NOT killed."
    FAIL=$((FAIL+1))
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════
# MUTANT 3: claimProvider omits factory releaseCapacity
#
# NoticeVaultAgreement.sol::claimProvider
#   OLD: // Release capacity at factory\n        INoticeVaultFactory(factory).releaseCapacity(total);\n\n        // Transfer to immutable provider\n        _safeTransferOut(token, provider, total);
#   NEW: same block without the releaseCapacity call
#
# Kill: test_T012_J_G2_closed_after_claim asserts factory.outstandingLiability()==0
#   and usdc.balanceOf(agreement)==0 after claimProvider+claimClientRefund.
#   Without the release, factory L stays at A+R → FAIL.
#   Also kills test_T015_H_G3_full_scenario (same assertion).
# ══════════════════════════════════════════════════════════════════════════
echo "=== Mutant 3: claimProvider omits releaseCapacity ==="
M3_OLD_F="/tmp/m3_old_$$.txt"
M3_NEW_F="/tmp/m3_new_$$.txt"
cat > "$M3_OLD_F" << 'OLDEOF'
        // Release capacity at factory
        INoticeVaultFactory(factory).releaseCapacity(total);

        // Transfer to immutable provider
        _safeTransferOut(token, provider, total);
OLDEOF
cat > "$M3_NEW_F" << 'NEWEOF'
        // MUTANT3: releaseCapacity omitted

        // Transfer to immutable provider
        _safeTransferOut(token, provider, total);
NEWEOF

save_backup "$AGR"
if ! mutate_files "$AGR" "$M3_OLD_F" "$M3_NEW_F"; then
    echo "[BLOCKED] Mutant 3: exact string not found."; restore_backup; exit 1
fi

M3_LOG="/tmp/mut3-$$.log"
set +e
run_forge "$M3_LOG" --match-test "test_T012_J_G2_closed_after_claim|test_T015_H_G3_full_scenario"
M3_EXIT=$?; set -e
M3_FAIL=$(count_fail "$M3_LOG")
restore_backup; rm -f "$M3_OLD_F" "$M3_NEW_F"

if [[ "$M3_FAIL" -gt 0 || "$M3_EXIT" -ne 0 ]]; then
    echo "[KILLED] Mutant 3 killed by: $(first_fail "$M3_LOG") (${M3_FAIL} failure(s))"
    PASS=$((PASS+1))
else
    echo "[SURVIVED] Mutant 3 NOT killed."
    FAIL=$((FAIL+1))
fi
echo ""

# ══════════════════════════════════════════════════════════════════════════
# MUTANT 4: TYPEHASH drops amountPerPeriod (EIP-712 binding weakened)
#
# NoticeVaultFactory.sol::TERMS_TYPEHASH keccak256 string literal
#   OLD: "uint256 amountPerPeriod,"\n        "uint64 periodSeconds,"
#   NEW: "uint64 periodSeconds,"   (amountPerPeriod line removed)
#
# Kill: test_T016_11_typehash_binding computes the correct typehash
#   independently (hardcoded), signs using it, and submits to the factory.
#   With the mutant factory typehash the domain digest differs from the
#   independently computed digest → ECDSA recovers wrong address →
#   InvalidSignature reverts → but test does NOT expectRevert → FAIL.
#
#   Actually: the test signs with factory.DOMAIN_SEPARATOR and the
#   locally computed correct TERMS_TYPEHASH. Factory uses mutant typehash.
#   factory.termsDigest() uses mutant typehash → different structHash →
#   different final digest → ECDSA recovery produces wrong address →
#   InvalidSignature → createAgreement reverts. Test expects success → FAIL.
# ══════════════════════════════════════════════════════════════════════════
echo "=== Mutant 4: TYPEHASH drops amountPerPeriod ==="
FACT="$ROOT/contracts/src/NoticeVaultFactory.sol"
M4_OLD_F="/tmp/m4_old_$$.txt"
M4_NEW_F="/tmp/m4_new_$$.txt"
cat > "$M4_OLD_F" << 'OLDEOF'
        "uint256 amountPerPeriod,"
        "uint64 periodSeconds,"
OLDEOF
cat > "$M4_NEW_F" << 'NEWEOF'
        "uint64 periodSeconds," // MUTANT4: amountPerPeriod dropped
NEWEOF

save_backup "$FACT"
if ! mutate_files "$FACT" "$M4_OLD_F" "$M4_NEW_F"; then
    echo "[BLOCKED] Mutant 4: exact string not found."; restore_backup; exit 1
fi

M4_LOG="/tmp/mut4-$$.log"
set +e
run_forge "$M4_LOG" --match-test "test_T016_11_typehash_binding"
M4_EXIT=$?; set -e
M4_FAIL=$(count_fail "$M4_LOG")
restore_backup; rm -f "$M4_OLD_F" "$M4_NEW_F"

if [[ "$M4_FAIL" -gt 0 || "$M4_EXIT" -ne 0 ]]; then
    echo "[KILLED] Mutant 4 killed by: $(first_fail "$M4_LOG") (${M4_FAIL} failure(s))"
    PASS=$((PASS+1))
else
    echo "[SURVIVED] Mutant 4 NOT killed."
    FAIL=$((FAIL+1))
fi
echo ""

# ── Summary ────────────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════"
echo "  Killed:   $PASS / 4"
echo "  Survived: $FAIL / 4"
echo "════════════════════════════════════════════════"
[[ "$FAIL" -eq 0 ]] && { echo "RESULT: PASS — all 4 mutants killed."; exit 0; }
echo "RESULT: FAIL — $FAIL mutant(s) survived."
exit 1
