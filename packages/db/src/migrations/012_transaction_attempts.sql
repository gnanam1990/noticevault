-- Additive journal. Existing local journals and database rows are not migrated or deleted.
CREATE TABLE transaction_attempts (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 actor text NOT NULL, chain_id text NOT NULL, resource text NOT NULL, action text NOT NULL,
 request_id uuid NOT NULL, binding text NOT NULL, network_nonce text NOT NULL,
 preparation jsonb NOT NULL, state text NOT NULL CHECK (state IN ('reserved','unknown','submitted','confirmed','reverted','reorged','conflicted','cancelled')),
 tx_hash text, proof jsonb, revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor,chain_id,workspace_id,request_id)
);
CREATE UNIQUE INDEX transaction_attempt_nonce ON transaction_attempts(actor,chain_id,network_nonce) WHERE state<>'cancelled';
CREATE INDEX transaction_attempt_resource ON transaction_attempts(chain_id,actor,resource);
CREATE TABLE transaction_attempt_events (
 id bigserial PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES transaction_attempts(id),
 from_state text, to_state text NOT NULL, proof jsonb, revision integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(attempt_id,revision)
);
