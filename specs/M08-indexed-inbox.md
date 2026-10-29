# M08 bounded indexed notification inbox

Extends the original local-activity-only demo specification under the authorized authenticated product scope. No external notification delivery, subscription, scheduler or credential setup is included.

Supported informational event types: AgreementCreated, RegularFunded, NoticeStarted, ProviderClaimed, ClientRefunded. Messages describe synthetic index observations, not confirmed live financial outcomes. No notification contains an inferred spendable balance or payment amount.

The worker persists one metadata record per (stream, block hash, transaction hash, log index), inside the same transaction as the canonical event/projection/cursor. A write failure rolls back ingestion. Immutable canonical event history remains the source of provenance. Notification rows survive reorgs for stable identity, but inbox reads and acknowledgements require the event to remain canonical under the explicitly associated creation/deployment policy. Revalidate event existence after acquiring the stream share lock; a candidate query before that lock is insufficient.

Current authenticated session, session chain, current workspace membership and explicit immutable association gate every read/ack. No address-only discovery or automatic workspace linking. Existing associations disclose the audience as current/future workspace members. Acknowledgements are idempotent and isolated by workspace, notification ID, member address and member chain. They only mark seen, never approve a financial transaction. POST retains existing CSRF guards.

Pages contain at most20 available canonical alerts, newest ingestion ID first. Scoped opaque cursors do not freeze a cross-request snapshot. A page can become empty when candidates are invalidated; older-page navigation may still be available. UI cancels/suppresses stale async results on account/chain/workspace changes, clears failed views, and labels synthetic source/unknown live freshness. Reorg changes become visible on refresh; no live subscription guarantee.

Migration011 is additive. This slice covers newly ingested events after the notification schema is enabled. Historical pre-migration events are NOT backfilled; the UI discloses this. Historical backfill and an explicit retention policy need a separately bounded follow-up. External email/push/webhook delivery is disabled; no production schedules or external recipients exist.
