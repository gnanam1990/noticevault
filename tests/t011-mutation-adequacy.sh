#!/usr/bin/env bash
# T-011 Mutation Adequacy — M01 financial model
#
# Four mutants; each uses its own disposable git worktree (outside main checkout).
# Cleanup in EXIT/RETURN traps. Main checkout (/home/user/app) is NEVER mutated.
# Setup failure exits 2 (BLOCKED), never 0 (success).
#
# This is MUTATION ADEQUACY evidence — it proves the test suite detects specific
# behavioural defects. It is NOT retrospective red-first evidence.
set -euo pipefail

REPO=/home/user/app
PASS=0; FAIL=0; BLOCKED=0
RESULTS=()

# ── Mutant runner ─────────────────────────────────────────────────────────────

run_mutant() {
  local id="$1" desc="$2" file_rel="$3"
  # old_text and new_text passed via environment variables OLD and NEW
  # (avoids quoting nightmares with special characters in positional args)
  local expect_pattern="$4"

  echo ""
  echo "════════════════════════════════════════════════════"
  echo "MUTANT $id — $desc"
  echo "════════════════════════════════════════════════════"

  # Create worktree in a temp dir that is cleaned up on RETURN
  local wt
  wt=$(mktemp -d /tmp/nv-mutant-"$id"-XXXXXX)

  cleanup_wt() {
    git -C "$REPO" worktree remove --force "$wt" 2>/dev/null || true
    rm -rf "$wt"
  }
  # Use subshell so trap RETURN fires per-invocation
  (
    trap cleanup_wt RETURN EXIT

    # 1. Create worktree at HEAD
    if ! git -C "$REPO" worktree add --detach "$wt" HEAD 2>/tmp/nv-wt-err-"$id".txt; then
      echo "BLOCKED: git worktree add failed"
      cat /tmp/nv-wt-err-"$id".txt >&2
      exit 2
    fi

    # 2. Verify target file exists
    local target="$wt/$file_rel"
    if [[ ! -f "$target" ]]; then
      echo "BLOCKED: $file_rel not found in worktree"
      exit 2
    fi

    # 3. Symlink node_modules to avoid reinstall
    [[ -d "$wt/node_modules" ]]            || ln -s "$REPO/node_modules"                    "$wt/node_modules"
    [[ -d "$wt/packages/domain/node_modules" ]] || ln -s "$REPO/packages/domain/node_modules" "$wt/packages/domain/node_modules"

    # ── Baseline: MUST be green ───────────────────────────────────────────
    echo "  [baseline] unmodified worktree..."
    local base_out base_exit
    set +e
    base_out=$(cd "$wt/packages/domain" && bun run test 2>&1)
    base_exit=$?
    set -e
    if [[ $base_exit -ne 0 ]]; then
      echo "  BLOCKED: baseline failed (exit $base_exit)"
      echo "$base_out" | tail -6
      exit 2
    fi
    local base_count
    base_count=$(echo "$base_out" | grep -E 'Tests +[0-9]+ passed' | tail -1 \
                 || echo "$base_out" | grep -E '[0-9]+ passed' | tail -1 || echo "?")
    echo "  BASELINE GREEN — $base_count"

    # ── Apply mutation via Python (argv-safe, no shell glob) ──────────────
    echo "  [mutant] applying mutation..."
    if ! python3 - "$target" "$OLD" "$NEW" <<'PYEOF'
import sys, pathlib
f = pathlib.Path(sys.argv[1])
old = sys.argv[2]
new = sys.argv[3]
t = f.read_text()
if old not in t:
    print(f"ERROR: mutation target string not found in {f}", file=sys.stderr)
    sys.exit(3)
f.write_text(t.replace(old, new, 1))
print(f"  mutation applied (replaced first occurrence)")
PYEOF
    then
      echo "  BLOCKED: mutation string not found in source"
      exit 2
    fi

    # ── Mutated run: MUST fail ────────────────────────────────────────────
    echo "  [mutant] running tests (expect failure)..."
    local mut_out mut_exit
    set +e
    mut_out=$(cd "$wt/packages/domain" && bun run test 2>&1)
    mut_exit=$?
    set -e

    echo "  mutant exit=$mut_exit"

    local match_line
    match_line=$(echo "$mut_out" | grep -E "$expect_pattern" | head -1 || true)

    if [[ $mut_exit -ne 0 ]] && [[ -n "$match_line" ]]; then
      echo "  KILLED — assertion: $match_line"
      exit 0  # success
    elif [[ $mut_exit -ne 0 ]]; then
      # Failed but pattern not matched — still killed, log the failure tail
      local fail_line
      fail_line=$(echo "$mut_out" | grep -E 'AssertionError|Error:|FAIL|×' | head -1 || echo "(see raw)")
      echo "  KILLED (exit $mut_exit, pattern unmatched) — $fail_line"
      exit 0  # still killed
    else
      echo "  SURVIVED — test suite did not detect the mutation"
      echo "$mut_out" | tail -5
      exit 1  # mutation survived = test weakness
    fi
  )
  local sub_exit=$?

  case $sub_exit in
    0)
      PASS=$((PASS+1))
      RESULTS+=("PASS  MUTANT-$id: $desc")
      ;;
    1)
      FAIL=$((FAIL+1))
      RESULTS+=("FAIL  MUTANT-$id: $desc — SURVIVED")
      ;;
    *)
      BLOCKED=$((BLOCKED+1))
      RESULTS+=("BLOCKED  MUTANT-$id: $desc")
      ;;
  esac

  # Ensure worktree is cleaned up (belt-and-suspenders)
  git -C "$REPO" worktree remove --force "$wt" 2>/dev/null || true
  rm -rf "$wt"
}

# ═══════════════════════════════════════════════════════════════════════════════
# MUTANT A — computeR: mulDivCeil → mulDivFloor
#
# Spec: R = ceil(A*N/P). With A=7, P=10, N=3: ceil(21/10)=3.
# Mutation: floor(21/10)=2.
# Kill evidence: t009 asserts computeR(terms)===3n; will see 2n.
# ═══════════════════════════════════════════════════════════════════════════════
OLD='export function computeR(terms: AgreementTerms): bigint {
  return mulDivCeil(terms.amountPerPeriod, terms.noticeSeconds, terms.periodSeconds);
}'
NEW='export function computeR(terms: AgreementTerms): bigint {
  return mulDivFloor(terms.amountPerPeriod, terms.noticeSeconds, terms.periodSeconds); // MUTANT-A
}'
export OLD NEW
run_mutant "A" \
  "computeR ceil→floor: A=7,P=10,N=3 must yield R=3 not R=2" \
  "packages/domain/src/model.ts" \
  "(expected 3|3n|Expected.*3|Received.*2|AssertionError)"

# ═══════════════════════════════════════════════════════════════════════════════
# MUTANT B — computeV ignores notice S (removes S clamp from effectiveStop)
#
# Spec: regularStop = min(now, D, S if present).
# Mutation: remove the S clamp → V accrues past notice start.
# Kill evidence: t007 conservation test (V+W overlap) or refund invariant fails.
# ═══════════════════════════════════════════════════════════════════════════════
OLD='  let stop = bigMin(now, D);
  if (notice !== null) stop = bigMin(stop, notice.S);'
NEW='  let stop = bigMin(now, D); // MUTANT-B: notice.S clamp removed'
export OLD NEW
run_mutant "B" \
  "computeV ignores notice S: regular accrual past notice start" \
  "packages/domain/src/model.ts" \
  "(AssertionError|conservation|overlap|refund|claimable|expected|Error)"

# ═══════════════════════════════════════════════════════════════════════════════
# MUTANT C — derived late notice: store S=now instead of S=D
#
# Spec: no stored notice AND now >= D → derived S=D, MISSED_CHECKPOINT.
# Mutation: return { S: now, ... } in resolveNotice.
# Kill evidence: t008 G2 fixture asserts S===D (day30), E===day60, W===1_000_000_000.
# ═══════════════════════════════════════════════════════════════════════════════
OLD='  if (now >= D) {
    // Derived overdue notice
    return { S: D, reason: "MISSED_CHECKPOINT", isStored: false };
  }'
NEW='  if (now >= D) {
    return { S: now, reason: "MISSED_CHECKPOINT", isStored: false }; // MUTANT-C
  }'
export OLD NEW
run_mutant "C" \
  "derived notice S=now not S=D: G2 must reject S=day40 (wrong S/E/W)" \
  "packages/domain/src/model.ts" \
  "(AssertionError|expected|S.*day|1_000_000_000|1000000000|E.*day|day30|Error)"

# ═══════════════════════════════════════════════════════════════════════════════
# MUTANT D — pre-start clientRefundable suppressed when now < t0
#
# Spec: after notice, clientRefundable = F - V_S - CR; available immediately
#       including NOTICE_SCHEDULED before t0.
# Mutation: force clientRefundable = 0n whenever now < terms.startAt.
# Kill evidence: t010 pre-start cancel test expects full refund (V_S=0, refund=F).
# ═══════════════════════════════════════════════════════════════════════════════
OLD='    const raw = F - V_S - CR;
    clientRefundable = raw > 0n ? raw : 0n;'
NEW='    const raw = F - V_S - CR;
    clientRefundable = (now >= terms.startAt && raw > 0n) ? raw : 0n; // MUTANT-D'
export OLD NEW
run_mutant "D" \
  "pre-start clientRefundable forced 0 when now<t0 (NOTICE_SCHEDULED)" \
  "packages/domain/src/model.ts" \
  "(AssertionError|expected|refund|clientRefundable|NOTICE_SCHEDULED|pre.?start|Error)"

# ═══════════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo "════════════════════════════════════════════════════"
echo "MUTATION ADEQUACY SUMMARY"
echo "════════════════════════════════════════════════════"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
echo "  KILLED  (PASS):    $PASS"
echo "  SURVIVED (FAIL):   $FAIL"
echo "  BLOCKED:           $BLOCKED"
echo ""
total_run=$((PASS + FAIL + BLOCKED))
echo "  Total mutants run: $total_run / 4"

if   [[ $FAIL    -gt 0 ]]; then echo "OVERALL: FAIL — $FAIL mutant(s) survived";          exit 1
elif [[ $BLOCKED -gt 0 ]]; then echo "OVERALL: PARTIAL — $BLOCKED setup failure(s)";       exit 2
else                             echo "OVERALL: PASS — all $PASS mutants killed";            exit 0
fi
