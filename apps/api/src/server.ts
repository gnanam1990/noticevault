import {captureVersionedRoutes,registerVersionedApi} from './versioned-api.js';
import {isEvidenceCollector,type EvidenceCollector} from './evidence-bundle.js';
import {evidenceRoutes} from './evidence-export.js';
import {preferenceRoutes} from './notification-preferences.js';
import {membershipRoutes} from './workspace-memberships.js';
import {privateRevisionRoutes,providerGrantRoutes} from './private-revisions.js';
import {operatorConsentRoutes} from './operator-consent.js';
import {isOperatorApprovalAdapter,assertOperatorApprovalBinding} from './operator-approval.js';
import {assertConfiguredRuntime} from './configured-runtime.js';
import type {ConfiguredRuntime} from './configured-runtime.js';
import {loadDeploymentAssessment,runVerificationStartup} from './verification-startup.js';
import {attemptRoutes} from './routes/attempts.js';
import type {SyntheticAttemptAdapter} from './attempt-evidence.js';
import {buildPinnedAuthVerifier} from './auth/pinned-verifier.js';
import type {SyntheticAuthProvider} from './auth/pinned-verifier.js';
import {creationPreparationRoutes} from './routes/creation-preparation.js';
import type {SyntheticConsentAdapter} from './routes/creation-preparation.js';
import {notificationRoutes} from './routes/notifications.js';
import { indexedAgreementRoutes } from './routes/indexed-agreements.js';
import { associationRoutes } from './routes/associations.js';
/**
 * @noticevault/api — Fastify server entry point
 *
 * Registers plugins, routes, and error handler.
 * Designed to be used both as a runnable server and via Fastify inject() in tests.
 *
 * CSRF protection:
 *  - A global onRequest hook enforces Origin + X-Requested-With on ALL
 *    state-mutating methods (POST, PUT, PATCH, DELETE). GET and OPTIONS are exempt.
 *    Individual route handlers also call requireCsrfHeaders, but the global hook
 *    is the authoritative gate — workspace/draft/intent routes do not need to call it.
 *
 * Rate limiting:
 *  - Applied globally via @fastify/rate-limit (1000 req/min per IP in dev).
 *
 * Error handling:
 *  - ApiError instances → typed JSON body with statusCode.
 *  - All other errors → 500 INTERNAL_ERROR (no stack leak).
 */

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ApiConfig } from "./config.js";
import { snapshotConsentDeployment } from "./consent-manifest.js";
import { ApiError } from "./errors.js";
import { createPool, runMigrations } from "@noticevault/db";
import type pg from "pg";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { draftRoutes } from "./routes/drafts.js";
import { intentRoutes } from "./routes/intents.js";
import { ecdsaVerifier, localFixtureVerifier } from "./auth/verify.js";

/** Methods that mutate state and require CSRF protection */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ServerOptions {
  operatorApproval?: SyntheticAttemptAdapter;
  evidenceCollector?: EvidenceCollector;
  configuredRuntime?: ConfiguredRuntime;
  cfg:            ApiConfig;
  syntheticAttempts?: SyntheticAttemptAdapter; // isolated tests only; never endpoint/config
  syntheticAuth?: SyntheticAuthProvider; // explicit isolated test construction only
  syntheticConsent?: SyntheticConsentAdapter; // isolated tests only; never CLI/config
  pool?:          pg.Pool;       // injected for tests
  skipMigration?: boolean;       // skip DB migration (tests manage schema)
  logger?:        boolean | object;
}

/**
 * Build and configure the Fastify instance. Does NOT call listen().
 * Tests use app.inject() directly.
 */
export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  if((opts.syntheticConsent || opts.syntheticAuth || opts.syntheticAttempts) && (Reflect.get(process.env,'NODE_ENV')!=="test" || !opts.pool || opts.skipMigration!==true || opts.cfg.configIdentity!=="LOCAL_FIXTURE")) throw new Error("Synthetic consent requires isolated test pool and construction");
  if(opts.configuredRuntime){assertConfiguredRuntime(opts.configuredRuntime,opts.cfg);if(opts.configuredRuntime.report.provenance==='SYNTHETIC'&&(!opts.pool||opts.skipMigration!==true))throw new Error('Synthetic runtime requires isolated pool');if(opts.syntheticAttempts||opts.syntheticAuth||opts.syntheticConsent)throw new Error('MIXED_RUNTIME_CONSTRUCTION');}
  const descriptor = snapshotConsentDeployment(opts.cfg.configIdentity, opts.cfg.consentDeployment);
  const cfg: ApiConfig = { ...opts.cfg, ...(descriptor ? { consentDeployment: descriptor } : {}) };
  const logger = opts.logger !== undefined ? opts.logger : cfg.configIdentity === "LOCAL_FIXTURE";

  const app = Fastify({ logger });
  const assessment=loadDeploymentAssessment(cfg.deploymentEvidencePath,cfg.consentDeployment);
  const readiness=opts.configuredRuntime?.report??{...assessment,diagnostics:[...assessment.diagnostics,'RUNTIME_TRANSPORTS_NOT_CONFIGURED']};
  app.get("/readiness", async (_req, reply) => reply.header("Cache-Control", "no-store").code(503).send(readiness));

  // ── Plugins ─────────────────────────────────────────────────────────────────

  await app.register(cookie, { secret: cfg.sessionSecret });

  // CORS plugin: only emits Allow-Origin for origins in the configured allowlist.
  // The callback signals `false` (no CORS header) for disallowed origins rather
  // than throwing — the browser receives a response with no ACAO header and the
  // preflight fails at the browser level. The global onRequest hook below is the
  // authoritative server-side gate that returns 403 for mutating requests from
  // non-allowed origins before any handler runs.
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow same-origin and allowed list only. Never reflect arbitrary origins.
      if (!origin || cfg.allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        // Signal false — no ACAO header emitted; do NOT throw (avoids 500 from cors plugin).
        cb(null, false);
      }
    },
    credentials: true,
    methods:     ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  await app.register(rateLimit, {
    max:       1000,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      error: { code: "RATE_LIMITED", message: "Too many requests" },
    }),
  });

  // ── Global CSRF hook — runs before ANY handler ─────────────────────────────
  // Enforces Origin + X-Requested-With on ALL state-mutating requests.
  // IMPORTANT: onRequest hooks must use reply.send() to short-circuit — they run
  // before setErrorHandler, so throwing here produces an unhandled 500 rather than
  // a typed 403. We call reply.send() with the structured body and return to stop
  // the lifecycle. Individual route handlers that also call requireCsrfHeaders are
  // belt-and-suspenders for direct calls without the full hook chain (e.g. unit tests).
  app.addHook("onRequest", async (req: FastifyRequest, reply) => {
    if (!MUTATING_METHODS.has(req.method)) return;

    const xrw = req.headers["x-requested-with"];
    if (xrw !== "XMLHttpRequest") {
      void reply.code(403).send({
        error: { code: "FORBIDDEN", message: "x-requested-with: XMLHttpRequest header required" },
      });
      return;
    }

    const origin = (req.headers["origin"] as string | undefined) ?? "";
    if (!cfg.allowedOrigins.includes(origin)) {
      void reply.code(403).send({
        error: { code: "FORBIDDEN", message: `Origin "${origin}" not in allowed list` },
      });
      return;
    }
  });

  // ── Pool ─────────────────────────────────────────────────────────────────────

  const pool = opts.pool ?? createPool(cfg.db);

  // Run migrations unless caller manages them (test mode)
  if (!opts.skipMigration) {
    const result = await runMigrations(pool, cfg.db.schema);
    if (result.errors.length > 0) {
      throw new Error(`Migration failed: ${JSON.stringify(result.errors)}`);
    }
  }

  // Shut down pool on close
  app.addHook("onClose", async () => {
    if (!opts.pool) {
      await pool.end();
    }
  });

  // ── Error handler ─────────────────────────────────────────────────────────────

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      void reply.status(err.statusCode).send(err.toBody());
      return;
    }
    app.log.error({ err }, "Unhandled error");
    void reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });

  // ── Signature verifier ────────────────────────────────────────────────────────
  // LOCAL_FIXTURE uses the test-only fixture verifier.
  // Production (ARC_TESTNET+) uses real ECDSA verification.
  // ERC-1271 requires a live RPC client; stub returns UNKNOWN when absent.

  const verifier = opts.configuredRuntime ? buildPinnedAuthVerifier(opts.configuredRuntime.auth) : opts.syntheticAuth ? buildPinnedAuthVerifier(opts.syntheticAuth) : cfg.configIdentity === "LOCAL_FIXTURE"
    ? localFixtureVerifier
    : ecdsaVerifier;

  // ── Routes ────────────────────────────────────────────────────────────────────

  const compatibilityRoutes=captureVersionedRoutes(app);
  await healthRoutes(app, pool, cfg.db.schema);
  await authRoutes(app, pool, cfg, verifier);
  await workspaceRoutes(app, pool, cfg);
  await membershipRoutes(app,pool,cfg);
  await draftRoutes(app, pool, cfg);
  await privateRevisionRoutes(app,pool,cfg);
  await providerGrantRoutes(app,pool,cfg);
  await intentRoutes(app, pool, cfg);
  await creationPreparationRoutes(app, pool, cfg, opts.configuredRuntime?.consent ?? opts.syntheticConsent);
  await associationRoutes(app, pool, cfg);
  await indexedAgreementRoutes(app, pool, cfg);
  await notificationRoutes(app, pool, cfg);
  await preferenceRoutes(app, pool, cfg);
if(opts.evidenceCollector&&(!isEvidenceCollector(opts.evidenceCollector)||(opts.evidenceCollector.source==='SYNTHETIC'&&Reflect.get(process.env,'NODE_ENV')!=='test')))throw Error('Verified evidence collector required');
await evidenceRoutes(app, pool, cfg,opts.evidenceCollector);
  if(opts.operatorApproval&&!isOperatorApprovalAdapter(opts.operatorApproval))throw Error('Verified operator composition required');
  if(opts.operatorApproval)assertOperatorApprovalBinding(opts.operatorApproval,cfg,pool,opts.configuredRuntime);
  if(opts.operatorApproval&&opts.configuredRuntime)await operatorConsentRoutes(app,pool,cfg,opts.configuredRuntime,opts.operatorApproval);
  await attemptRoutes(app,pool,cfg,opts.operatorApproval ?? opts.configuredRuntime?.attempts ?? opts.syntheticAttempts);

  await registerVersionedApi(app,pool,cfg,compatibilityRoutes,Boolean(opts.configuredRuntime));
  return app;
}

// ── CLI entry point ──────────────────────────────────────────────────────────

if (process.argv[1] && (
  process.argv[1].endsWith("server.ts") ||
  process.argv[1].endsWith("server.js")
)) {
  if(process.argv[2]==="--verify-deployment"){
    const result=runVerificationStartup(process.argv.slice(2));
    console.log(JSON.stringify(result.report));
    process.exitCode=result.exitCode;
  }else{
  const { loadApiConfig } = await import("./config.js");
  const cfg = loadApiConfig();
  const { buildConfiguredServer } = await import('./configured-startup.js');
    const { loadOperatorApprovalInputs } = await import('./operator-startup.js');
  const operatorInputs = await loadOperatorApprovalInputs();
  const app = await buildConfiguredServer({ cfg, ...(operatorInputs ? { operatorInputs } : {}) });
  await app.listen({ port: cfg.port, host: cfg.host });
  app.log.info(`NoticeVault API running at http://${cfg.host}:${cfg.port}`);
  }
}
