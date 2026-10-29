/**
 * @noticevault/api — health and readiness routes
 *
 * GET /health   — liveness: process is up
 * GET /ready    — readiness: DB pool can execute a query
 */

import type { FastifyInstance } from "fastify";
import type pg from "pg";

export async function healthRoutes(
  app:    FastifyInstance,
  pool:   pg.Pool,
  schema: string,
): Promise<void> {
  app.get("/health", async (_req, reply) => {
    void reply.send({ status: "ok", ts: new Date().toISOString() });
  });

  app.get("/ready", async (_req, reply) => {
    try {
      await pool.query("SELECT 1");
      void reply.send({ status: "ready", schema, ts: new Date().toISOString() });
    } catch (err) {
      void reply.status(503).send({
        status: "not_ready",
        error:  err instanceof Error ? err.message : String(err),
      });
    }
  });
}
