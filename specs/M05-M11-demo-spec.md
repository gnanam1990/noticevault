# NoticeVault M05–M11 synthetic demo specification

Designed 2026-10-21 from the existing M01 retainer model. This document specifies the implemented browser-only demo, not completion of the original live modules. Normative financial behavior remains specs/CORE-CONTRACT-M01.md and packages/domain. No alternate formulas or live-success claims are allowed.

## Scope by module

| Module | Synthetic implementation | Live capability excluded/unverified |
|---|---|---|
| M05 | Domain-backed event projection, transfer deltas, unique event identity, ordered/duplicate validation | RPC indexer, canonical-chain/reorg reconciliation |
| M06 | Client overview, exact-value draft/review, funding, notice, refund | Authenticated backend/wallet transactions |
| M07 | Provider view and claim simulation using immutable terms | Real provider identity/signing/payout |
| M08 | Local activity and lossless evidence/raw-storage download controls | External notifications/delivery guarantees |
| M09 | Pure/controller regressions through the production handler | Rendered browser/UI/E2E acceptance blocked by Forbidden |
| M10 | Truthful readiness and blocker list | Deployment, live manifest/code/consent verification |
| M11 | Handoff, dated exits, source hashes and remaining acceptance checklist | Production release/security audit |

## Financial and action contract

All values use bigint micro-USDC. R=ceil(A*N/P), D=t0+(F/A)*P and all accrued/refundable/claimable calculations come from domain functions. Renewal requires client role, no notice, now<D and matching expectedD. Only exact A is added. Notice reasons are CLIENT_CANCELLED or MISSED_CHECKPOINT. Provider and refund transitions use the agreement's immutable recipients; no real transfer occurs. UI role checks are demo controls, not authentication. Domain consistency validation is reused, including NP<=R; N need not equal P.

Commands are proposed without a write. Confirm re-reads controller state and checks session/revision/role/clock/checkpoint and persisted command ID, computes the actual domain transition and amount, validates the entire next envelope, writes exactly one active snapshot, then notifies the UI. Failed/no-op/stale commands do not create a financial success record. New draft creation and draft clearing share the same commit; repeated client nonce acceptance rejects. Navigation/cancel/back never execute a financial command.

## Persistence and preservation

Active namespace is noticevault-demo-v2:state. It contains schema version, SIMULATION provenance, session/revision, agreements, observation clock, role, raw draft strings, activity and applied IDs. Bigints and tag-like literal strings serialize losslessly. Mount reads do not write. Unknown/corrupt/version-invalid/legacy-only payloads block persisted edits and retain raw bytes. The raw-export UI exports exact stored strings inside a JSON envelope. Explicit reset archives current/legacy raw payloads first and then replaces only the active v2 snapshot; failure is surfaced. Other keys and v1 keys are not deleted.

Runtime checks validate shapes, enums, addresses, production terms at their recorded creation time, uint256 nonce, domain consistency, accounting/event totals, event ordering/IDs, applied-time bounds and paid-vs-accrued amounts. The supported clock range is positive UTC seconds through year 9999. Clock rewind cannot precede creation or an applied event. This validation is not cryptographic provenance; the browser owner controls localStorage. One tab is the supported use model; compare-before-write is not a cross-tab transaction.

## Fixtures and UX

Initial G1/G2/G3 agreements are seeded in memory at the synthetic epoch and remain unacted upon until the user chooses actions. Separate ADD fixture controls create a fresh unique agreement relative to the current clock: G1 observes cancellation at day 15; G2 observes missed checkpoint at day 40; G3 observes day-29 renewal and day-35 cancellation. G1 provider total at notice end is 4500 and refund 1500; G2 final provider total is 6000; G3 final provider total is 6500 and refund 2500 USDC. Paid plus liability equals total funding plus reserve.

Client/provider roles and scenario time are available on desktop and mobile. Amount entry accepts exact decimals up to six places; duration decimals must represent whole seconds. UTC dates must roundtrip exactly. Draft confirmation revalidates domain terms. Synthetic labels stay visible, and readiness distinguishes current unit evidence, historical results, blocked integration and not-run browser acceptance.

## Acceptance and limits

Controller tests must execute createDemoController with fake storage rather than simulate guards in the test body. Required regressions: repeated/stale confirmation, role rejection, no-op claims, exact deadline, interrupted draft/reload, duplicate draft acceptance, valid N<P and N>P notice settlement, serialization beyond 2^53, corrupt/invalid payload quarantine, read/quota failures, archival/final reset failure, fixture addition and full settlement.

UI/E2E remains NOT RUN while Arc full preview returns Forbidden. No alternate host, proxy or permission bypass is permitted. After the owner restores ordinary preview access, use the browser acceptance checklist in docs/HANDOFF.md. No production wallet connection, credentials, DB resources, deployment, signing or funds are in this demo acceptance scope.
