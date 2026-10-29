-- Informational index evidence only. External delivery is not configured.
CREATE TABLE indexed_notifications (
 id bigserial PRIMARY KEY,
 stream_id text NOT NULL REFERENCES indexer_streams(stream_id) ON DELETE RESTRICT,
 agreement text NOT NULL,
 block_number numeric(78,0) NOT NULL,
 block_hash text NOT NULL,
 transaction_hash text NOT NULL,
 log_index numeric(78,0) NOT NULL,
 event_name text NOT NULL CHECK (event_name IN ('AgreementCreated','RegularFunded','NoticeStarted','ProviderClaimed','ClientRefunded')),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(stream_id,block_hash,transaction_hash,log_index)
);
CREATE INDEX indexed_notifications_workspace_lookup ON indexed_notifications(stream_id,agreement,id DESC);
CREATE TABLE notification_receipts (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
 notification_id bigint NOT NULL REFERENCES indexed_notifications(id) ON DELETE RESTRICT,
 member_address text NOT NULL,
 member_chain text NOT NULL,
 acknowledged_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,notification_id,member_address,member_chain)
);
