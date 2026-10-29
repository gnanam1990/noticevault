-- Preserve existing rows. Never infer a legacy membership's chain from an address.
CREATE TABLE wallet_identities (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 chain_id BIGINT NOT NULL CHECK (chain_id > 0),
 wallet_address TEXT NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (chain_id, wallet_address)
);
INSERT INTO wallet_identities (chain_id,wallet_address)
 SELECT DISTINCT chain_id,lower(member_address) FROM sessions;
ALTER TABLE sessions ADD COLUMN user_id UUID REFERENCES wallet_identities(id);
UPDATE sessions s SET user_id=u.id FROM wallet_identities u
 WHERE u.chain_id=s.chain_id AND u.wallet_address=lower(s.member_address);
ALTER TABLE sessions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE workspace_memberships ADD COLUMN chain_id BIGINT CHECK (chain_id > 0);
ALTER TABLE workspace_memberships DROP CONSTRAINT workspace_memberships_pkey;
ALTER TABLE workspace_memberships ADD CONSTRAINT workspace_memberships_identity_key UNIQUE (workspace_id,member_address,chain_id);
COMMENT ON COLUMN workspace_memberships.chain_id IS 'NULL preserves unbound legacy records; never authorizes a session. Binding requires explicit reviewed migration.';
-- Internal session writers also receive the exact canonical chain/address identity.
CREATE FUNCTION bind_session_identity() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN -- trigger function body; not a migration transaction
 INSERT INTO wallet_identities(chain_id,wallet_address) VALUES(NEW.chain_id,lower(NEW.member_address))
 ON CONFLICT(chain_id,wallet_address) DO UPDATE SET wallet_address=EXCLUDED.wallet_address RETURNING id INTO NEW.user_id;
 RETURN NEW;
END;
$$;
CREATE TRIGGER sessions_bind_identity BEFORE INSERT OR UPDATE OF chain_id,member_address,user_id ON sessions
 FOR EACH ROW EXECUTE FUNCTION bind_session_identity();
