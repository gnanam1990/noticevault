/**
 * @noticevault/db — workspace repository
 *
 * All queries are parameterized. Column names are explicit.
 * Functions accept a PoolClient for transaction support.
 */

import type { Pool, PoolClient } from "pg";
import type { WorkspaceRow, WorkspaceMembershipRow } from "../types.js";

type Db = Pool | PoolClient;

// ── Workspaces ────────────────────────────────────────────────────────────────

export async function createWorkspace(
  db: Db,
  schema: string,
  id: string,
  name: string,
  ownerAddress: string,
): Promise<WorkspaceRow> {
  const r = await db.query<WorkspaceRow>(
    `INSERT INTO ${schema}.workspaces (id, name, owner_address)
     VALUES ($1, $2, $3)
     RETURNING id, name, owner_address, created_at, updated_at`,
    [id, name, ownerAddress.toLowerCase()],
  );
  if (!r.rows[0]) throw new Error("createWorkspace: no row returned");
  return r.rows[0];
}

export async function getWorkspaceById(
  db: Db,
  schema: string,
  id: string,
): Promise<WorkspaceRow | null> {
  const r = await db.query<WorkspaceRow>(
    `SELECT id, name, owner_address, created_at, updated_at
     FROM ${schema}.workspaces WHERE id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

// ── Memberships ────────────────────────────────────────────────────────────────

export async function addMembership(
  db: Db,
  schema: string,
  workspaceId: string,
  memberAddress: string,
  role: "owner" | "member" | "editor" | "viewer",
  chainId?: bigint,
): Promise<WorkspaceMembershipRow> {
  const r = await db.query<WorkspaceMembershipRow>(
    `INSERT INTO ${schema}.workspace_memberships (workspace_id, member_address, role, chain_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, member_address, chain_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING workspace_id, member_address, role, joined_at`,
    [workspaceId, memberAddress.toLowerCase(), role, chainId?.toString() ?? null],
  );
  if (!r.rows[0]) throw new Error("addMembership: no row returned");
  return r.rows[0];
}

export async function getMembership(
  db: Db,
  schema: string,
  workspaceId: string,
  memberAddress: string,
  chainId: bigint,
): Promise<WorkspaceMembershipRow | null> {
  const r = await db.query<WorkspaceMembershipRow>(
    `SELECT id, workspace_id, member_address, role, joined_at, chain_id
     FROM ${schema}.workspace_memberships
     WHERE workspace_id = $1 AND lower(member_address) = lower($2) AND chain_id = $3`,
    [workspaceId, memberAddress, chainId.toString()],
  );
  return r.rows[0] ?? null;
}

export async function listMemberships(
  db: Db,
  schema: string,
  workspaceId: string,
): Promise<WorkspaceMembershipRow[]> {
  const r = await db.query<WorkspaceMembershipRow>(
    `SELECT id, workspace_id, member_address, role, joined_at, chain_id
     FROM ${schema}.workspace_memberships
     WHERE workspace_id = $1
     ORDER BY joined_at ASC`,
    [workspaceId],
  );
  return r.rows;
}
