import { mutateOnce } from '../mutations.js';
/**
 * @noticevault/api — workspace routes
 *
 * POST /workspaces          — create workspace (session required; actor from session)
 * GET  /workspaces/:id      — get workspace (session required; membership required)
 * GET  /workspaces/:id/members — list members (session required; membership required)
 *
 * Authorization: every route verifies session membership.
 * Actor is ALWAYS derived from session.memberAddress — never from request body.
 */

import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import type { ApiConfig } from "../config.js";
import { requireSession } from "./auth.js";
import {
  createWorkspace,
  getWorkspaceById,
  addMembership,
  getMembership,
  listMemberships,
} from "@noticevault/db";
import { badRequest, notFound, forbidden } from "../errors.js";

interface CreateWorkspaceBody { name: string; }

export async function workspaceRoutes(
  app:  FastifyInstance,
  pool: pg.Pool,
  cfg:  ApiConfig,
): Promise<void> {
  const { schema } = cfg.db;

  // Read-only discovery; membership is checked in the same SQL statement.
  app.get<{ Querystring: { after?: string } }>("/workspaces", async (req, reply) => {
    const session = await requireSession(req, pool, schema);
    const after = req.query.after;
    if (after !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after)) throw badRequest("Invalid workspace cursor");
    const result = await pool.query(
      `SELECT w.id,w.name FROM ${schema}.workspaces w WHERE EXISTS (SELECT 1 FROM ${schema}.workspace_memberships m WHERE m.workspace_id=w.id AND lower(m.member_address)=lower($1) AND m.chain_id=$3) AND ($2::uuid IS NULL OR w.id>$2::uuid) ORDER BY w.id LIMIT 21`,
      [session.memberAddress, after ?? null, session.chainId.toString()],
    );
    const items = result.rows.slice(0, 20);
    return reply.send({ items, nextCursor: result.rows.length > 20 ? items[19].id : null });
  });

  // POST /workspaces
  app.post<{ Body: CreateWorkspaceBody }>("/workspaces", async (req, reply) => {
    const session = await requireSession(req, pool, schema);

    const { name } = req.body ?? {};
    if (!name || typeof name !== "string" || name.trim().length === 0 || name.length > 128) {
      throw badRequest("name must be 1–128 characters");
    }

    if (req.headers['idempotency-key'] !== undefined) {
      const result = await mutateOnce(pool, schema, session.memberAddress, session.chainId, req.headers['idempotency-key'], 'POST /workspaces', { name: name.trim() }, async (client) => {
        const id = randomUUID();
        const ws = await createWorkspace(client, schema, id, name.trim(), session.memberAddress);
        await addMembership(client, schema, id, session.memberAddress, 'owner', session.chainId);
        return { status: 201, body: ws };
      });
      return reply.status(result.status).send(result.body);
    }

    // Use a transaction: create workspace + add owner membership atomically
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const id = randomUUID();
      const ws = await createWorkspace(client, schema, id, name.trim(), session.memberAddress);
      await addMembership(client, schema, id, session.memberAddress, "owner", session.chainId);
      await client.query("COMMIT");
      void reply.status(201).send(ws);
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* best-effort */ }
      throw err;
    } finally {
      client.release();
    }
  });

  // GET /workspaces/:id
  app.get<{ Params: { id: string } }>("/workspaces/:id", async (req, reply) => {
    const session = await requireSession(req, pool, schema);
    const { id } = req.params;

    const ws = await getWorkspaceById(pool, schema, id);
    if (!ws) throw notFound("workspace", id);

    // Authorize: caller must be a member
    const membership = await getMembership(pool, schema, id, session.memberAddress, session.chainId);
    if (!membership) throw forbidden("You are not a member of this workspace");

    void reply.status(200).send(ws);
  });

  // GET /workspaces/:id/members
  app.get<{ Params: { id: string } }>("/workspaces/:id/members", async (req, reply) => {
    const session = await requireSession(req, pool, schema);
    const { id } = req.params;

    const ws = await getWorkspaceById(pool, schema, id);
    if (!ws) throw notFound("workspace", id);

    // Authorize: caller must be a member
    const membership = await getMembership(pool, schema, id, session.memberAddress, session.chainId);
    if (!membership) throw forbidden("You are not a member of this workspace");

    const members = await listMemberships(pool, schema, id);
    void reply.status(200).send(members);
  });
}

function randomUUID(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
