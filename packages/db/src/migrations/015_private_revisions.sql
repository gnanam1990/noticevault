-- Additive: existing drafts/doc hashes are retained, never relabelled as uploaded bytes.
CREATE TABLE draft_revisions (
 id UUID PRIMARY KEY REFERENCES terms_drafts(id),
 family_id UUID NOT NULL REFERENCES terms_drafts(id),
 workspace_id UUID NOT NULL REFERENCES workspaces(id),
 revision_number INTEGER NOT NULL CHECK(revision_number>0),
 chain_id BIGINT NOT NULL CHECK(chain_id>0),
 provider_address TEXT NOT NULL,
 document_bytes BYTEA NOT NULL CHECK(octet_length(document_bytes) BETWEEN 1 AND 262144),
 document_hash TEXT NOT NULL,
 deployment_json JSONB,
 domain_json JSONB,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(family_id,revision_number)
);
CREATE TABLE revision_provider_grants (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 revision_id UUID NOT NULL REFERENCES draft_revisions(id),
 chain_id BIGINT NOT NULL,
 provider_address TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 revoked_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX revision_grant_access ON revision_provider_grants(revision_id,chain_id,provider_address);
CREATE FUNCTION protect_private_revision() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN -- function body; not a migration transaction
 IF TG_TABLE_NAME='draft_revisions' THEN RAISE EXCEPTION 'Immutable revision cannot be rewritten'; END IF;
 IF EXISTS(SELECT 1 FROM draft_revisions WHERE id=OLD.id) AND (NEW.terms_json,NEW.doc_hash,NEW.version,NEW.workspace_id,NEW.author_address) IS DISTINCT FROM (OLD.terms_json,OLD.doc_hash,OLD.version,OLD.workspace_id,OLD.author_address) THEN RAISE EXCEPTION 'Create a new immutable revision'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER private_revision_immutable BEFORE UPDATE ON draft_revisions FOR EACH ROW EXECUTE FUNCTION protect_private_revision();
CREATE TRIGGER revision_terms_immutable BEFORE UPDATE ON terms_drafts FOR EACH ROW EXECUTE FUNCTION protect_private_revision();
