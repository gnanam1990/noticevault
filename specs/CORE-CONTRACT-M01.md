# NoticeVault — Core Contract Financial Rules (M01 normative)

> Source: M01 prompt, 2026-09-16. Authoritative for packages/domain implementation.
> ZIP unavailable; these rules were provided directly in the M01 prompt text.

---

## AgreementTerms (canonical ABI order)

| Field | TS type | ABI type | Notes |
|---|---|---|---|
| schemaVersion | number | uint32 | Always 1 |
| client | string | address | Non-zero, != provider |
| provider | string | address | Non-zero, != client |
| token | string | address | Must match allowlisted 6-decimal token context |
| amountPerPeriod (A) | bigint | uint256 | > 0 |
| periodSeconds (P) | bigint | uint64 | [3600, 2678400] |
| noticeSeconds (N) | bigint | uint64 | [3600, 7776000] |
| startAt (t0) | bigint | uint64 | [creationNow+300, creationNow+604800] |
| clientNonce | bigint | uint256 | Any |
| acceptanceDeadline | bigint | uint64 | Equality = expired |
| termsDocumentHash | string | bytes32 | Valid 32-byte hex |

TS money/time/nonce: bigint. schemaVersion = 1.

---

## Production validation rules

- P in [3600, 2678400]
- N in [3600, 7776000]
- t0 in [creationNow+300, creationNow+604800]
- A > 0
- acceptanceDeadline equality is expired (>= now => not expired; < now or == now => expired)
- All money cumulatives and F+R <= UINT256_MAX
- t0, acceptanceDeadline, D, D+N <= 9223372036854775807 (INT64_MAX, despite uint64 ABI)
- Check every renewal's new D, D+N and new F+R BEFORE state changes
- Positive caps are explicit inputs; use amount <= cap-currentLiability after validating
  current <= cap; not overflowing sums
- Per-agreement and factory limits apply to outstanding LIABILITY, not lifetime F
- Paid headroom is reusable; lifetime arithmetic still bounded
- No truncation; full-precision bigint intermediates (may exceed 256 bits in mulDiv);
  final persisted result must fit uint256
- Floor/ceil helper validation: rejects negative amounts/divisor<=0
- Never Number/float/formatted text for money/time calculations

---

## Accounting state

| Field | Type | Notes |
|---|---|---|
| terms | AgreementTerms | Immutable |
| regularFunded (F) | bigint | Initial = A; each renewal += exactly A |
| regularPaid (RP) | bigint | Cumulative provider regular claims |
| noticePaid (NP) | bigint | Cumulative provider notice claims |
| clientRefunded (CR) | bigint | Cumulative client refunds |
| noticeStartStored | bigint \| null | null = no notice; zero timestamp must not mean absent |
| noticeReasonStored | NoticeReason \| null | CLIENT_CANCELLED or MISSED_CHECKPOINT |

- R = ceil(A*N/P) — immutable, computed from terms
- First funding = A+R (one period of regular + full notice reserve)
- D = t0 + (F/A)*P — exact; F must always be exact multiple of A
- Cumulative accounted inflows = F+R
- L = F+R - RP - NP - CR (outstanding liability)
- Conservation: F+R = RP + NP + CR + L at all times
- Direct token donations are separately supplied excess actual balance; NEVER increase
  F, R, D or accounted cap counters
- Solvency: independently supplied actual balance >= L
- Malformed states must be validated, not silently clamped

---

## Notice mechanics

### Effective notice S (at observation timestamp `now`):
1. Stored notice => use immutable stored S and reason
2. No stored notice AND now >= D => derived S=D, reason=MISSED_CHECKPOINT
3. Otherwise => S absent

### startNotice(state, now, actor):
- ALWAYS client only — any other actor => UnauthorizedActor
- Already stored => NoticeAlreadyStarted
- No stored notice AND now >= D => store S=D / MISSED_CHECKPOINT (NOT now)
- Otherwise => S = max(now, t0), reason = CLIENT_CANCELLED
- Repeated startNotice after storing => reject unchanged
- Failed transitions return no partial state/events

### materializeNotice (permissionless):
- If stored: return existing S with NO new event
- If derived (now >= D): store S=D with event
- If neither: FundingWindowClosed error
- Late materialization NEVER restarts time

---

## Accrual formulas

Regular stop = min(now, D, S if present)
elapsed = max(0, stop - t0)
V = floor(A * elapsed / P), capped at F

With no S: W = 0
With S: W = floor(R * clamp(now-S, 0, N) / N)
At/after E = S+N: W = R exactly

ProviderClaimable = (V - RP) + (W - NP)

Before notice: ClientRefundable = 0
After stored OR DERIVED notice:
  V_S = floor(A * max(0, min(S, D) - t0) / P)
  ClientRefundable = F - V_S - CR
  Available immediately, including NOTICE_SCHEDULED (before t0)

Pre-start cancellation:
  Regular earned = zero; FULL notice schedule from t0 (NOT free cancellation)
  Future ordinary accrual cannot resume after S

---

## Lifecycle phases

- S absent + now < t0 => SCHEDULED
- S absent + now >= t0 => ACTIVE
- S present + now < S => NOTICE_SCHEDULED
- S <= now < S+N => NOTICE
- now >= S+N with unpaid L > 0 => ENDED_CLAIMABLE
- notice finished + L = 0 => CLOSED

(DRAFT, wallet pending/unknown/stale, acceptance: outside deployed financial enum)

---

## Transitions

### claimProvider (permissionless, no destination arg):
- Pays ONLY to provider address
- Compute deltas cumulatively (not time since last claim)
- Update RP/NP; reduce liability; reduce exact supplied actual balance
- Materialize derived notice if needed
- Zero claims return zero with NO payment event/capacity reduction
- Transfer failure in pure injected effect simulation => prior state unchanged
- Donation stays surplus; no rescue

### claimClientRefund (permissionless, destination = ONLY client):
- Touch CR, not RP/NP
- Valid before t0 once scheduled notice exists
- Zero claims return zero with no event

### fundNextPeriod(state, now, actor, expectedFundedThrough):
- Client only
- No stored or derived notice; now < D strictly; expected == D
- Exact A new regular funding
- Errors: UnauthorizedClient, NoticeAlreadyStarted/FundingWindowClosed,
  CheckpointMismatch, InvalidTerms (overflow), AgreementCapExceeded,
  FactoryCapExceeded
- Compute ALL validation first; no partial state
- Duplicate same expected D: only first call succeeds
- At D equality: too late, no grace/backdate/resurrection
- Race: renewal then cancellation before old D => both succeed using renewed state
- Race: cancellation then renewal => renewal rejects

---

## calculateReferenceSnapshot output

Label source/evidence: SIMULATION
Fields: schemaVersion, observationTimestamp, phase, D, S (nullable), E (nullable),
reason (nullable), V, W, RP, NP, providerClaimable, clientRefundable, L, R,
noticeRemaining = R - NP, hasStoredNotice; actual balance optional if explicitly supplied.
NEVER live AgreementSnapshot evidence.

---

## Golden fixtures (amounts in micro-USDC, offsets from t0)

A = 3_000_000_000, P = N = 2_592_000 (30 days), R = 3_000_000_000
Initial inflows = A + R = 6_000_000_000

**G1** — cancel at day 15:
- At day 15: V=1_500_000_000, W=0
- After startNotice at day 15: clientRefundable=1_500_000_000 immediately
- Regular frozen; by day 45: W=3_000_000_000
- Provider total: V + W = 1_500_000_000 + 3_000_000_000 = 4_500_000_000
- Client refund: 1_500_000_000
- Conservation: 4_500_000_000 + 1_500_000_000 = 6_000_000_000 ✓

**G2** — no renewal, observe day 40 (MISSED_CHECKPOINT, no materialization):
- S = day 30 (= D), E = day 60, reason = MISSED_CHECKPOINT
- V = 3_000_000_000 (= F, capped), W = floor(3e9 * (10d/30d)) = 1_000_000_000
- Day 60: provider total = 3_000_000_000 + 3_000_000_000 = 6_000_000_000; refund = 0

**G3** — renew day 29, expectedD = day 30:
- F = 6_000_000_000, D = day 60, R unchanged = 3_000_000_000
- Cancel day 35: V_S = floor(3e9 * 5d/30d) = 500_000_000 (5 days into second period)
- Wait: S = day 35, E = day 65
- clientRefundable = 6_000_000_000 - 500_000_000 = 5_500_000_000? 
- Re-check: F-V_S-CR = 6e9 - 500_000_000 - 0 = 5_500_000_000
- Provider at E: V = 500_000_000 (frozen at S=day35), W = 3_000_000_000
- Total provider = 3_500_000_000; refund = 5_500_000_000
- Inflows = 9_000_000_000; conservation: 3_500_000_000 + 5_500_000_000 = 9_000_000_000 ✓

Note: M01 prompt states provider total 6_500_000_000 and refund 2_500_000_000 for G3.
Deriving: V_S = floor(A*(S-t0)/P) = floor(3e9*35d/30d) = floor(3_500_000_000) = 3_500_000_000
but capped at F=6e9; S=day35 is in second period (day 30-60).
elapsed from t0 to min(S=day35, D=day60) = 35 days.
V_S = floor(3e9 * 35*86400 / (30*86400)) = floor(3e9 * 35/30) = floor(3_500_000_000) = 3_500_000_000.
clientRefundable = 6e9 - 3_500_000_000 - 0 = 2_500_000_000. 
Provider total at E: V=3_500_000_000 + W=3_000_000_000 = 6_500_000_000.
Conservation: 6_500_000_000 + 2_500_000_000 = 9_000_000_000 ✓ (matches prompt).

---

## Test IDs

T006 — normal cumulative accrual day 15 and valid renewal
T007 — cancellation instant W=0, no overlap, ordinary freeze/refund/full notice G1
T008 — late observation/materialization G2 and event idempotency
T009 — A=7,P=10,N=3 many claims vs single; overflow/cap/conservation; small durations
        in separate model-test fixtures only (validateTerms uses PRODUCTION ranges)
T010 — boundary timestamps; pre-start cancel; client-only overdue startNotice;
        repeated stored rejection; race orders; failed transitions deep-equal input

---

## Constraints on M01

- No Solidity, no RPC, no signing, no database, no API, no UI
- No invented addresses or Arc-specific proof
- Pure model receives explicit creation timestamp/context, caps, authorized actor
- Signature crypto belongs to M02/M03
- Small durations for T009 only in separate model-test fixture context; never weaken
  production validateTerms ranges
