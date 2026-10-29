-- Atomic receipts for authenticated authoring retries; no expiry/reuse of keys.
CREATE TABLE mutation_receipts (
 actor_address text NOT NULL, chain_id text NOT NULL, request_key uuid NOT NULL,
 operation text NOT NULL, request_hash text NOT NULL,
 status integer NOT NULL CHECK (status BETWEEN 200 AND 299), response_json jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (actor_address, chain_id, request_key)
);
