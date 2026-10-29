-- Explicit participant-authorized sharing; independent of rebuilt canonical projections.
CREATE TABLE workspace_agreement_associations (
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
 stream_id text NOT NULL REFERENCES indexer_streams(stream_id) ON DELETE RESTRICT,
 agreement text NOT NULL, fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 proof jsonb NOT NULL, associated_by text NOT NULL, associated_chain text NOT NULL,
 audience text NOT NULL CHECK(audience='current-and-future-workspace-members'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,stream_id,agreement)
);
CREATE FUNCTION reject_agreement_association_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Agreement associations are immutable; no silent rebinding or removal'; END;
$$;
CREATE TRIGGER immutable_agreement_association BEFORE UPDATE OR DELETE ON workspace_agreement_associations
FOR EACH ROW EXECUTE FUNCTION reject_agreement_association_change();
