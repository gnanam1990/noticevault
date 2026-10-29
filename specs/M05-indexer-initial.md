# M05 initial durable ingestion slice

Source contract: NoticeVaultFactory.sol AgreementCreated(agreement,client,provider,amountPerPeriod,periodSeconds,noticeSeconds,startAt,noticeReserve,initialFunded). This slice persists decoded, complete block envelopes from an injected transport. It does not assert live verification or replace SDK evidence.

An explicitly synthetic stream binds chainId, factory and starting parent checkpoint immutably. Process contiguous blocks in order. Each transaction locks the stream cursor, inserts a block record, deduplicated event identities and immutable agreement directory rows, then advances the cursor. Exact whole-block replay is a no-op. Conflicting block/event identity, factory substitution, gaps or mismatched parent hash fail without cursor/projection changes. Amount/time fields remain canonical decimal strings; no financial balance is inferred from this partial event subset.

Event identity is stream + transaction hash + block-global log index; a second block cannot reuse it. Exact duplicates inside one block normalize to one event; differing duplicates fail. Projection conflicts roll back the entire block. A recreated worker resumes from PostgreSQL, not process memory.

Synthetic streams only in this milestone. Later slices must add raw ABI decoding/complete-block RPC transport, provenance/finality policy, canonical reorg rollback/replay, all lifecycle event projections and production stream enablement. Do not turn these persisted rows into VERIFIED consent or transaction evidence.

## Synthetic reconciliation contract (2026-10-23)
The rollbackToAncestor production library supports explicit SYNTHETIC branch simulation only. Caller supplies expectedHeadHash plus ancestorNumber/ancestorHash. The ancestor must be the configured anchor or a stored canonical block. Stream binding and current head are checked under the same transaction lock as ingestion. Repeating a completed rollback is idempotent only at that same current recorded ancestor.

Migration 003 backfills and retains block/event provenance independently of canonical membership. Reconciliation preserves this history, rebuilds only the creation directory from retained canonical events, rewinds the cursor atomically, and allows normal ordered replay on either branch. Historical block hash/content conflicts fail closed. Errors leave cursor, canonical rows and projections unchanged.

No target chain finality policy or live branch selection is specified by these synthetic fixtures. Live transport, raw decoding and lifecycle projections require separate implementation/verification. See implementation-records/M05-reorg-2026-10-23.md for reproducible real-PostgreSQL evidence.

## Factory raw-log adapter (2026-10-23)
For source SYNTHETIC, decodeFactoryBlock accepts a chainId/factory-bound block envelope with decimal number, hash, parentHash and complete logs array. Each log uses RPC blockNumber, blockHash, transactionHash, transactionIndex, logIndex, removed=false, address, topics and data. Only the existing AgreementCreated ABI is accepted. Unknown events, malformed widths/addresses/quantities, mismatched identities and conflicting duplicates fail closed.

Pass its result into ingestBlock. Attached raw bytes and metadata are revalidated against decoded fields before storage and retained in immutable event history through reconciliation. Existing decoded-only records are not relabeled as raw evidence. This adapter checks supplied synthetic consistency; it does not prove RPC completeness, deployed bytecode or target-network canonicality/finality. See implementation-records/M05-decoding-2026-10-23.md.

## Partial funding lifecycle projection (2026-10-23)
Supported lifecycle event: RegularFunded only. decodeLifecycleBlock accepts factory creation plus raw agreement funding events. ingestBlock requires the agreement's canonical creation before accepting funding. Cumulative regular funding starts at A, then advances by exactly A per event; emitted newF and newD must match prior projection and the existing computeD equation. Monetary fields remain bigint/decimal strings.

The funding projection is not a spendable balance or full AccountingState. It does not reconstruct consent, transaction authorization, outstanding claims or settlement. NoticeStarted, ProviderClaimed and ClientRefunded remain explicitly unsupported. Reorg rebuild uses the same ordered projection path and preserves orphan raw history. See implementation-records/M05-funding-2026-10-23.md.

## NoticeStarted partial projection (2026-10-23)
NoticeStarted is now supported through decodeLifecycleBlock with an explicit decimal block timestamp. Reason 1 requires time<D and S=max(time,startAt); reason 2 requires time>=D and S=D. Store S, S+N and the exact reason. The agreement must already exist canonically; a second notice or later funding fails. If funding includes block time, time>=its prior D also fails. Canonical event order, raw provenance and atomic replay/reorg behavior are preserved.

These are supplied synthetic header checks, not live-chain proof. Existing events without timestamps are not retroactively given evidence. ProviderClaimed/ClientRefunded, settlement and spendable balances remain unsupported. See implementation-records/M05-notice-2026-10-23.md.

## 2026-10-23 ProviderClaimed checkpoint (supersedes earlier claim status)

M05 now decodes and transactionally projects ProviderClaimed with exact cumulative regular/notice amounts, canonical provider binding, timestamp/order guards and reorg/restart replay. ClientRefunded remains unsupported; no external balance or payout is inferred. Final isolated PostgreSQL claims 15/15 plus restart/replay; prior ingestion 9, reorg 8, decoder 27, funding 12, notice 17 and DB/API 24 all pass, exit 0. DB/API units 30/101 and relevant types/lint pass. Evidence: implementation-records/M05-claims-2026-10-23.md. Next: ClientRefunded settlement projection. Live transport, live inputs, UI acceptance and deployment remain unverified; fail-closed gates unchanged.

ProviderClaimed requires strict actual ABI, raw timestamp equality, exact nonzero V-regularPaid and W-noticePaid, W=floor(R*elapsed/N), canonical provider recipient, preceding default notice at/after D, nondecreasing observed time, atomic cursor/event/projection and immutable history replay. Migration 006 stores observed cumulative claims only. Unsupported ClientRefunded blocks ingestion.

## 2026-10-23 ClientRefunded checkpoint (supersedes earlier refund status)

ClientRefunded is now decoded and projected with exact cumulative unused regular principal, original-client binding, immediate resolved-notice semantics, claim/refund conservation, authoritative event order and atomic rollback/replay. Refunds do not wait for notice end. All four agreement lifecycle events plus creation now have synthetic real-PostgreSQL coverage. Final refunds 16/16 plus restart; previous ingestion/reorg/decoder/funding/notice/claims/DB-API all pass. DB/API units 30/101, types and worker lint pass, exit 0. See implementation-records/M05-refunds-2026-10-23.md and its evidence directory.

M05 remains incomplete for live operation: complete-block RPC transport/runnable worker, provenance/finality policy and production stream enablement are pending; LIVE_TRANSPORT_NOT_ENABLED remains enforced. No external balance, payout or VERIFIED consent is inferred from indexed rows. UI acceptance, live inputs and deployment remain unverified.

ClientRefunded: exact amount=F-V(S)-alreadyRefunded, positive only; recipient from immutable creation client; no notice-end gate, including pre-start cancellation. Implicit default has no refundable principal. Preserve unpaid provider entitlement and raw event history; timestamp/order validation and transaction rollback apply. Migration 007 backfills only zero observed refund counters.

## 2026-10-23 injected RPC transport checkpoint

M05 now has a TEST ONLY injected RPC adapter and durable runSyntheticStep boundary with pinned factory/token checks, per-transaction receipts, exact relevant log reconciliation, address-page limit handling, canonical recheck and bounded cancellation. Final 25/25 plus real PostgreSQL/process restart; previous lifecycle/DB/API compatibility, units, types and lint pass. Default CLI deliberately exits 1 with LIVE_TRANSPORT_NOT_ENABLED. No endpoint was contacted. Record: implementation-records/M05-transport-2026-10-23.md.

Live HTTP/provider integration, target-chain provenance/finality and automatic branch reconciliation, durable deployment-policy binding, operational configuration and live validation remain pending. This is RPC consistency testing, not consensus/receipt-trie proof or live completion. Existing consent/security guards remain enforced.

Transport contract: no partial block reaches ingestion; one block per durable page; split address groups on explicit -32005 limits, otherwise fail closed. Require exact canonical deployment getter bytes, every transaction receipt, ordered receipt log indices, complete relevant query agreement, and header/chain recheck. Cancellation during RPC leaves cursor unchanged; an entered database transaction completes atomically. HTTP/live/finality enablement is excluded.
