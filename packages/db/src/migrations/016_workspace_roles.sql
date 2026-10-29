-- Preserve legacy member semantics; new access grants use editor or viewer explicitly.
ALTER TABLE workspace_memberships ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE workspace_memberships ADD CONSTRAINT workspace_membership_id UNIQUE(id);
ALTER TABLE workspace_memberships DROP CONSTRAINT workspace_memberships_role_check;
ALTER TABLE workspace_memberships ADD CONSTRAINT workspace_memberships_role_check CHECK(role IN ('owner','member','editor','viewer'));
