-- Migration 001: initial NoticeVault schema
-- Executed inside a transaction by the migration runner (migrate.ts).
-- search_path is SET LOCAL to the designated schema before this runs.
-- NEVER references the public schema or any migration table in public.
-- All CREATE statements use IF NOT EXISTS for idempotency.
-- NUMERIC(78,0) for all bigint/uint256 amounts — never float.

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id             UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL CHECK (length(name) BETWEEN 1 AND 128),
  owner_address  TEXT        NOT NULL CHECK (owner_address ~ '^0x[0-9a-fA-F]{40}$'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspaces_owner_address_idx
  ON workspaces (lower(owner_address));

-- Workspace memberships (owner is always also a member with role 'owner')
CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  member_address  TEXT        NOT NULL CHECK (member_address ~ '^0x[0-9a-fA-F]{40}$'),
  role            TEXT        NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, member_address)
);

CREATE INDEX IF NOT EXISTS workspace_memberships_address_idx
  ON workspace_memberships (lower(member_address));

-- Wallet sign-in challenges (single-use; consumed atomically on verify)
-- The canonical sign-in message is rebuilt from these stored fields at verify time.
-- issued_at is stored explicitly so verify reconstructs the EXACT same message bytes
-- the wallet signed — not a re-sampled value.
-- uri and origin are stored so the verify handler can reconstruct the message
-- without re-deriving them from the incoming request (which could differ).
CREATE TABLE IF NOT EXISTS wallet_challenges (
  id           UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  address      TEXT        NOT NULL CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),
  domain       TEXT        NOT NULL CHECK (length(domain) BETWEEN 1 AND 253),
  origin       TEXT        NOT NULL CHECK (length(origin) BETWEEN 1 AND 2048),
  uri          TEXT        NOT NULL CHECK (length(uri)    BETWEEN 1 AND 2048),
  chain_id     BIGINT      NOT NULL,
  nonce        TEXT        NOT NULL CHECK (length(nonce) = 32),  -- 16-byte hex
  issued_at    TIMESTAMPTZ NOT NULL,  -- stored explicitly; not DEFAULT now()
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  CONSTRAINT wallet_challenges_nonce_unique
    UNIQUE (address, domain, chain_id, nonce)
);

CREATE INDEX IF NOT EXISTS wallet_challenges_address_idx
  ON wallet_challenges (lower(address));
CREATE INDEX IF NOT EXISTS wallet_challenges_expires_at_idx
  ON wallet_challenges (expires_at);

-- Sessions (HttpOnly cookie; DB-backed; revocable)
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID            REFERENCES workspaces(id) ON DELETE SET NULL,
  member_address  TEXT        NOT NULL CHECK (member_address ~ '^0x[0-9a-fA-F]{40}$'),
  chain_id        BIGINT      NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sessions_member_address_idx
  ON sessions (lower(member_address));
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx
  ON sessions (expires_at);

-- Terms drafts (versioned; immutable after accepted_consent exists)
CREATE TABLE IF NOT EXISTS terms_drafts (
  id              UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_address  TEXT        NOT NULL CHECK (author_address ~ '^0x[0-9a-fA-F]{40}$'),
  version         INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
  terms_json      JSONB       NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('draft','awaiting_consent','accepted','superseded','expired')),
  doc_hash        TEXT        NOT NULL CHECK (doc_hash ~ '^0x[0-9a-fA-F]{64}$'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS terms_drafts_workspace_idx
  ON terms_drafts (workspace_id);

-- Accepted provider consents (immutable record; one per draft+signer)
CREATE TABLE IF NOT EXISTS accepted_consents (
  id               UUID          NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id         UUID          NOT NULL REFERENCES terms_drafts(id) ON DELETE RESTRICT,
  workspace_id     UUID          NOT NULL REFERENCES workspaces(id)   ON DELETE RESTRICT,
  signer_address   TEXT          NOT NULL CHECK (signer_address ~ '^0x[0-9a-fA-F]{40}$'),
  terms_digest     TEXT          NOT NULL CHECK (terms_digest ~ '^0x[0-9a-fA-F]{64}$'),
  signature_hex    TEXT          NOT NULL CHECK (length(signature_hex) >= 132),
  consent_method   TEXT          NOT NULL CHECK (consent_method IN ('ecdsa','erc1271')),
  pinned_block     NUMERIC(78,0) NOT NULL,
  chain_id         BIGINT        NOT NULL,
  signed_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT accepted_consents_draft_signer_unique
    UNIQUE (draft_id, signer_address)
);

CREATE INDEX IF NOT EXISTS accepted_consents_workspace_idx
  ON accepted_consents (workspace_id);

-- Idempotent operation intents (SIMULATION only in M04; never CONFIRMED chain proof)
-- Unique constraint binds (idempotency_key, actor_address, workspace_id, operation)
-- so different actors cannot share a key even within the same workspace.
CREATE TABLE IF NOT EXISTS intents (
  id                       UUID          NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key          TEXT          NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  payload_hash             TEXT          NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  workspace_id             UUID          NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_address            TEXT          NOT NULL CHECK (actor_address ~ '^0x[0-9a-fA-F]{40}$'),
  operation                TEXT          NOT NULL CHECK (length(operation) BETWEEN 1 AND 64),
  status                   TEXT          NOT NULL CHECK (status IN ('pending','prepared','simulation_only','failed')),
  evidence_source          TEXT          CHECK (evidence_source IN ('VERIFIED','SIMULATION','LOCAL_FIXTURE')),
  evidence_block           NUMERIC(78,0),
  evidence_config_identity TEXT,
  result_json              JSONB,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- Actor-scoped idempotency: same key from different actors is NOT the same intent
  CONSTRAINT intents_idempotency_actor_workspace_op_unique
    UNIQUE (idempotency_key, actor_address, workspace_id, operation)
);

CREATE INDEX IF NOT EXISTS intents_workspace_actor_idx
  ON intents (workspace_id, lower(actor_address));
