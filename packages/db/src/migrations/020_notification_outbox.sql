ALTER TABLE indexer_blocks ADD COLUMN observed_timestamp numeric(20,0) CHECK(observed_timestamp>=0);
ALTER TABLE indexer_block_history ADD COLUMN observed_timestamp numeric(20,0) CHECK(observed_timestamp>=0);
CREATE TABLE notification_destinations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES wallet_identities(id),
 channel text NOT NULL CHECK(channel IN ('IN_APP','EMAIL')), target text NOT NULL CHECK(length(target) BETWEEN 1 AND 254),
 verified_at timestamptz, revoked_at timestamptz, UNIQUE(id,user_id), UNIQUE(user_id,channel,target)
);
CREATE TABLE notification_preferences (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id uuid NOT NULL REFERENCES wallet_identities(id),
 destination_id uuid NOT NULL,enabled boolean NOT NULL DEFAULT false,categories text[] NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 PRIMARY KEY(workspace_id,user_id),FOREIGN KEY(destination_id,user_id) REFERENCES notification_destinations(id,user_id)
);
CREATE TABLE notification_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),user_id uuid NOT NULL REFERENCES wallet_identities(id),
 destination_id uuid NOT NULL REFERENCES notification_destinations(id),preference_version integer NOT NULL,
 stream_id text NOT NULL,agreement text NOT NULL,category text NOT NULL,semantic_key text NOT NULL,
 block_number numeric(78,0) NOT NULL,block_hash text NOT NULL,source text NOT NULL CHECK(source IN ('SYNTHETIC','RPC_OBSERVED')),
 payload jsonb NOT NULL,state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','attempted','accepted','delivered','failed','unknown','stale')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 attempted_at timestamptz,receipt text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,user_id,preference_version,stream_id,agreement,category,semantic_key)
);
CREATE INDEX notification_outbox_due ON notification_outbox(next_attempt_at,id) WHERE state IN ('queued','attempted','unknown','accepted');
ALTER TABLE notification_preferences ADD COLUMN checked_at timestamptz;
CREATE TABLE notification_messages (outbox_id uuid PRIMARY KEY REFERENCES notification_outbox(id),user_id uuid NOT NULL REFERENCES wallet_identities(id),workspace_id uuid NOT NULL REFERENCES workspaces(id),payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
