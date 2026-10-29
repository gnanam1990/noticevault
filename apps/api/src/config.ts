/**
 * @noticevault/api — server configuration
 *
 * Fails closed on missing required config. Never silently falls back
 * to LOCAL_FIXTURE credentials in production mode.
 *
 * Config identity rules:
 *  - "LOCAL_FIXTURE": uses docker-compose defaults; must be explicitly opted-in.
 *  - "ARC_TESTNET": requires explicit PGHOST + SESSION_SECRET env vars.
 *  - "ARC_MAINNET": requires explicit configuration; no deployment defaults.
 */

import { loadDbConfig, localFixtureDbConfig } from "@noticevault/db";
import type { NoticeVaultDeployment } from "@noticevault/sdk";
import { LOCAL_FIXTURE_DEPLOYMENT } from "@noticevault/sdk";
import { snapshotConsentDeployment } from "./consent-manifest.js";
import { loadArcManifest } from "./deployment-manifest.js";
import type { DbConfig } from "@noticevault/db";

export type ConfigIdentity = "LOCAL_FIXTURE" | "ARC_TESTNET" | "ARC_MAINNET";

export interface ApiConfig {
  readonly configIdentity: ConfigIdentity;
  /** Explicit descriptor, never proof of deployed code. No default factory address. */
  readonly consentDeployment?: NoticeVaultDeployment;
  readonly deploymentEvidencePath?: string;
  readonly port:           number;
  readonly host:           string;
  readonly db:             DbConfig;
  readonly sessionSecret:  string;
  /** Cookie domain — e.g. "localhost" in dev */
  readonly cookieDomain:   string;
  /** Allowed CORS origins (exact match) */
  readonly allowedOrigins: readonly string[];
  /** Session TTL in seconds */
  readonly sessionTtlSecs: number;
  /** Challenge TTL in seconds */
  readonly challengeTtlSecs: number;
  /** Allowed sign-in domains (exact match for challenge binding) */
  readonly allowedDomains: readonly string[];
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optPositiveInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (isNaN(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${v}"`);
  return n;
}

export function loadApiConfig(): ApiConfig {
  const identity = (process.env["CONFIG_IDENTITY"] ?? "") as ConfigIdentity;

  if (identity === "LOCAL_FIXTURE") {
    // Explicit local dev mode
    const sessionSecret = process.env["SESSION_SECRET"] ?? "local_fixture_session_secret_dev_only_32b";
    return {
      configIdentity:    "LOCAL_FIXTURE",
      ...(process.env["LOCAL_FIXTURE_FACTORY_ADDRESS"] ? { consentDeployment: snapshotConsentDeployment("LOCAL_FIXTURE", { ...LOCAL_FIXTURE_DEPLOYMENT, factoryAddress: process.env["LOCAL_FIXTURE_FACTORY_ADDRESS"]! })! } : {}),
      port:              optPositiveInt("PORT", 3001),
      host:              "127.0.0.1",
      db:                localFixtureDbConfig(),
      sessionSecret,
      cookieDomain:      process.env["COOKIE_DOMAIN"] ?? "localhost",
      allowedOrigins:    ["http://localhost:5173", "http://localhost:3001"],
      sessionTtlSecs:    optPositiveInt("SESSION_TTL_SECS", 86_400),
      challengeTtlSecs:  optPositiveInt("CHALLENGE_TTL_SECS", 300),
      allowedDomains:    ["localhost"],
    };
  }

  if (identity === "ARC_TESTNET" || identity === "ARC_MAINNET") {
    const workspaceOnly = process.env["NOTICEVAULT_WORKSPACE_ONLY"] === "1";
    if (workspaceOnly && (process.env["NOTICEVAULT_OPERATOR_APPROVAL_CONFIG"] || process.env["NOTICEVAULT_OPERATOR_REVIEW_SHA256"] || process.env["NOTICEVAULT_DEPLOYMENT_MANIFEST"] || process.env["NOTICEVAULT_DEPLOYMENT_EVIDENCE"])) throw new Error("Workspace-only startup cannot load financial execution or deployment configuration");
    const consentDeployment = workspaceOnly ? undefined : loadArcManifest(req("NOTICEVAULT_DEPLOYMENT_MANIFEST"),identity);
    return {
      ...(consentDeployment ? {consentDeployment} : {}),
    ...(process.env["NOTICEVAULT_DEPLOYMENT_EVIDENCE"] ? { deploymentEvidencePath: process.env["NOTICEVAULT_DEPLOYMENT_EVIDENCE"]! } : {}),
      configIdentity:    identity,
      port:              optPositiveInt("PORT", 3001),
      host:              process.env["HOST"] ?? "0.0.0.0",
      db:                loadDbConfig(),
      sessionSecret:     req("SESSION_SECRET"),
      cookieDomain:      req("COOKIE_DOMAIN"),
      allowedOrigins:    req("ALLOWED_ORIGINS").split(",").map((s) => s.trim()),
      sessionTtlSecs:    optPositiveInt("SESSION_TTL_SECS", 86_400),
      challengeTtlSecs:  optPositiveInt("CHALLENGE_TTL_SECS", 300),
      allowedDomains:    req("ALLOWED_DOMAINS").split(",").map((s) => s.trim()),
    };
  }

  // Unknown or missing CONFIG_IDENTITY — fail closed
  throw new Error(
    `CONFIG_IDENTITY must be "LOCAL_FIXTURE" or "ARC_TESTNET" or "ARC_MAINNET", got "${identity}". ` +
    `Production server refuses to start without explicit configuration.`,
  );
}
