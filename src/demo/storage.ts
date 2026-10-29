/**
 * NoticeVault Demo — localStorage layer.
 *
 * Namespace: "noticevault-demo-v1:" prefix on ALL keys.
 * Bigint values tagged as "bigint:<decimal>" — never raw JSON.
 *
 * CORRUPT PAYLOAD POLICY:
 *   - On parse failure or shape validation failure, return StorageResult { ok: false }.
 *   - The RAW bytes are preserved in the result for export/recovery UI.
 *   - NEVER auto-overwrite or reset a corrupt payload.
 *   - Intentional reset is explicit, named, and confirmed by the caller.
 *   - No localStorage.clear() anywhere in this module.
 *
 * QUOTA/SECURITY POLICY:
 *   - All getItem/setItem calls are wrapped; SecurityError, QuotaExceededError, etc.
 *     are caught and returned as StorageResult { ok: false }.
 *   - A failed setItem does NOT corrupt the in-memory state.
 */

import { assertConsistentState, validateTerms, assertUint256 } from "@noticevault/domain";
import type { AccountingState } from "@noticevault/domain";
import { DEMO_TOKEN_CTX } from "./scenarios.js";
import type { DemoAgreement, DraftProgress, ActivityEntry, DemoRole, StorageResult } from "./types.js";

// ── Key registry ───────────────────────────────────────────────────────────────

const NS = "noticevault-demo-v1:";
const KEY_AGREEMENTS   = `${NS}agreements`;
const KEY_CLOCK        = `${NS}scenarioClock`;
const KEY_DRAFT        = `${NS}draftProgress`;
const KEY_ACTIVITY     = `${NS}activityLog`;
const KEY_ROLE         = `${NS}role`;

export const STORAGE_KEYS = { KEY_AGREEMENTS, KEY_CLOCK, KEY_DRAFT, KEY_ACTIVITY, KEY_ROLE } as const;

// ── Bigint-safe JSON ───────────────────────────────────────────────────────────

const BIGINT_TAG = "bigint:";

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return `${BIGINT_TAG}${value.toString(10)}`;
  if (typeof value === "string" && /^(bigint:|string:)/.test(value)) return `string:${value}`;
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("string:")) return value.slice(7);
  if (typeof value === "string" && value.startsWith(BIGINT_TAG)) {
    const digits = value.slice(BIGINT_TAG.length);
    if (!/^-?\d+$/.test(digits)) throw new Error(`Invalid bigint tag value: ${JSON.stringify(value)}`);
    return BigInt(digits);
  }
  return value;
}

export function safeStringify(value: unknown): string {
  return JSON.stringify(value, replacer);
}

export function safeParse<T>(json: string): T {
  return JSON.parse(json, reviver) as T;
}

// ── Safe localStorage access (quota/security wrapped) ─────────────────────────

function safeGetItem(key: string): { ok: true; value: string | null } | { ok: false; error: string } {
  try {
    return { ok: true, value: localStorage.getItem(key) };
  } catch (err) {
    return { ok: false, error: `localStorage.getItem failed: ${String(err)}` };
  }
}

function safeSetItem(key: string, value: string): { ok: true } | { ok: false; error: string } {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `localStorage.setItem failed (quota or security): ${String(err)}` };
  }
}

function safeRemoveItem(key: string): void {
  try { localStorage.removeItem(key); } catch { /* best-effort */ }
}

// ── Generic read ───────────────────────────────────────────────────────────────

function readKey<T>(key: string): StorageResult<T> {
  const get = safeGetItem(key);
  if (!get.ok) return { ok: false, error: get.error, raw: null };
  if (get.value === null) return { ok: true, value: undefined as unknown as T };
  try {
    const value = safeParse<T>(get.value);
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: `Parse error: ${String(err)}`, raw: get.value };
  }
}

// ── Generic write (returns error — caller decides what to do on failure) ───────

export function writeKey<T>(key: string, value: T): StorageResult<void> {
  let serialized: string;
  try { serialized = safeStringify(value); } catch (err) { return { ok: false, error: String(err), raw: null }; }
  const set = safeSetItem(key, serialized);
  if (!set.ok) return { ok: false, error: set.error, raw: null };
  return { ok: true, value: undefined };
}

// ── Shape validation helpers ───────────────────────────────────────────────────

function isAddress(v: unknown): boolean {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/i.test(v);
}

function isBytes32(v: unknown): boolean {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/i.test(v);
}

function isBigintPositiveOrZero(v: unknown): boolean {
  return typeof v === "bigint" && v >= 0n;
}

function validateAgreementTerms(t: unknown): string | null {
  if (!t || typeof t !== "object") return "terms: not an object";
  const o = t as Record<string, unknown>;
  if (o["schemaVersion"] !== 1) return "terms.schemaVersion !== 1";
  if (!isAddress(o["client"]))   return "terms.client: invalid address";
  if (!isAddress(o["provider"])) return "terms.provider: invalid address";
  if (!isAddress(o["token"]))    return "terms.token: invalid address";
  if (!isBigintPositiveOrZero(o["amountPerPeriod"])) return "terms.amountPerPeriod: not a non-negative bigint";
  if (typeof o["amountPerPeriod"] === "bigint" && (o["amountPerPeriod"]) === 0n) return "terms.amountPerPeriod: must be > 0";
  if (!isBigintPositiveOrZero(o["periodSeconds"])) return "terms.periodSeconds: not a non-negative bigint";
  if (typeof o["periodSeconds"] === "bigint" && (o["periodSeconds"]) === 0n) return "terms.periodSeconds: must be > 0";
  if (!isBigintPositiveOrZero(o["noticeSeconds"])) return "terms.noticeSeconds: not a non-negative bigint";
  if (!isBigintPositiveOrZero(o["startAt"])) return "terms.startAt: not a non-negative bigint";
  if (!isBigintPositiveOrZero(o["acceptanceDeadline"])) return "terms.acceptanceDeadline: not a non-negative bigint";
  if (typeof o["clientNonce"] !== "bigint" || (o["clientNonce"]) < 0n) return "terms.clientNonce: not a bigint >= 0";
  if (!isBytes32(o["termsDocumentHash"])) return "terms.termsDocumentHash: invalid bytes32";
  return null;
}

function validateAccountingState(s: unknown): string | null {
  if (!s || typeof s !== "object") return "accountingState: not an object";
  const o = s as Record<string, unknown>;
  const termsErr = validateAgreementTerms(o["terms"]);
  if (termsErr) return termsErr;
  if (!isBigintPositiveOrZero(o["regularFunded"]))   return "regularFunded: not a non-negative bigint";
  if (!isBigintPositiveOrZero(o["regularPaid"]))     return "regularPaid: not a non-negative bigint";
  if (!isBigintPositiveOrZero(o["noticePaid"]))      return "noticePaid: not a non-negative bigint";
  if (!isBigintPositiveOrZero(o["clientRefunded"]))  return "clientRefunded: not a non-negative bigint";
  if (o["noticeStartStored"] !== null && !isBigintPositiveOrZero(o["noticeStartStored"])) {
    return "noticeStartStored: must be null or non-negative bigint";
  }
  if (o["noticeReasonStored"] !== null && o["noticeReasonStored"] !== "CLIENT_CANCELLED" && o["noticeReasonStored"] !== "MISSED_CHECKPOINT") return "Invalid notice reason";
  try { assertConsistentState(s as AccountingState); } catch (err) { return String(err); }
  return null;
}

function validateProjectedEvent(e: unknown, idx: number): string | null {
  if (!e || typeof e !== "object") return `event[${idx}]: not an object`;
  const o = e as Record<string, unknown>;
  if (typeof o["id"] !== "string" || !o["id"]) return `event[${idx}].id: missing or empty`;
  if (!["NoticeStarted", "ProviderClaimed", "ClientRefunded", "PeriodFunded"].includes(String(o["kind"]))) return `event[${idx}].kind: invalid`;
  if (!isBigintPositiveOrZero(o["scenarioTime"])) return `event[${idx}].scenarioTime: not a non-negative bigint`;
  if (!isBigintPositiveOrZero(o["deltaAmount"]))     return `event[${idx}].deltaAmount: not a bigint`;
  if (o["actor"] !== "CLIENT" && o["actor"] !== "PROVIDER" && o["actor"] !== "SYSTEM") {
    return `event[${idx}].actor: must be CLIENT, PROVIDER, or SYSTEM`;
  }
  if (typeof o["description"] !== "string")     return `event[${idx}].description: not a string`;
  return null;
}

export function validateDemoAgreement(a: unknown, idx: number): string | null {
  if (!a || typeof a !== "object") return `agreement[${idx}]: not an object`;
  const o = a as Record<string, unknown>;
  if (typeof o["id"] !== "string" || !o["id"])   return `agreement[${idx}].id: missing`;
  if (typeof o["name"] !== "string")              return `agreement[${idx}].name: not a string`;
  if (!isBigintPositiveOrZero(o["createdAt"]))    return `agreement[${idx}].createdAt: not a non-negative bigint`;
  const stateErr = validateAccountingState(o["state"]);
  if (stateErr) return `agreement[${idx}].${stateErr}`;
  try { const terms = (o["state"] as AccountingState).terms; validateTerms(terms, o["createdAt"] as bigint, DEMO_TOKEN_CTX); assertUint256(terms.clientNonce, "clientNonce"); } catch (err) { return String(err); }
  if (!Array.isArray(o["eventLog"]))              return `agreement[${idx}].eventLog: not an array`;
  for (let i = 0; i < (o["eventLog"] as unknown[]).length; i++) {
    const evErr = validateProjectedEvent((o["eventLog"] as unknown[])[i], i);
    if (evErr) return `agreement[${idx}].${evErr}`;
  }
  return null;
}

// ── Agreements ────────────────────────────────────────────────────────────────

export function loadAgreements(): StorageResult<DemoAgreement[]> {
  const result = readKey<DemoAgreement[]>(KEY_AGREEMENTS);
  if (!result.ok) return result;
  if (result.value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(result.value)) {
    const raw = safeGetItem(KEY_AGREEMENTS);
    return { ok: false, error: "agreements: not an array", raw: raw.ok ? raw.value : null };
  }
  for (let i = 0; i < result.value.length; i++) {
    const err = validateDemoAgreement(result.value[i], i);
    if (err) {
      const raw = safeGetItem(KEY_AGREEMENTS);
      return { ok: false, error: `Validation failed: ${err}`, raw: raw.ok ? raw.value : null };
    }
  }
  return result;
}

export function saveAgreements(agreements: DemoAgreement[]): StorageResult<void> {
  return writeKey(KEY_AGREEMENTS, agreements);
}

/** Reset only the named synthetic namespace key. Never clears other localStorage keys. */
export function resetAgreements(): void {
  safeRemoveItem(KEY_AGREEMENTS);
}

// ── Scenario clock ────────────────────────────────────────────────────────────

export function loadClock(): StorageResult<bigint | null> {
  const result = readKey<bigint | null>(KEY_CLOCK);
  if (!result.ok) return result;
  if (result.value === undefined || result.value === null) return { ok: true, value: null };
  if (typeof result.value !== "bigint" || result.value <= 0n) {
    const raw = safeGetItem(KEY_CLOCK);
    return { ok: false, error: "clock: not a positive bigint", raw: raw.ok ? raw.value : null };
  }
  return result;
}

export function saveClock(clock: bigint): StorageResult<void> {
  return writeKey(KEY_CLOCK, clock);
}

// ── Draft progress ────────────────────────────────────────────────────────────

export function validateDraftProgress(d: unknown): string | null {
  if (!d || typeof d !== "object") return "draft: not an object";
  const o = d as Record<string, unknown>;
  if (typeof o["name"] !== "string") return "draft.name: not a string";
  if (!o["fields"] || typeof o["fields"] !== "object") return "draft.fields: not an object";
  if (Array.isArray(o["fields"]) || Object.values(o["fields"]).some(v => typeof v !== "string")) return "draft.fields: values must be strings";
  return null;
}

export function loadDraft(): StorageResult<DraftProgress | null> {
  const result = readKey<DraftProgress | null>(KEY_DRAFT);
  if (!result.ok) return result;
  if (result.value === undefined || result.value === null) return { ok: true, value: null };
  const err = validateDraftProgress(result.value);
  if (err) {
    const raw = safeGetItem(KEY_DRAFT);
    return { ok: false, error: `Draft validation: ${err}`, raw: raw.ok ? raw.value : null };
  }
  return result;
}

export function saveDraft(draft: DraftProgress): StorageResult<void> {
  return writeKey(KEY_DRAFT, draft);
}

export function clearDraft(): void {
  safeRemoveItem(KEY_DRAFT);
}

// ── Activity log ──────────────────────────────────────────────────────────────

export function validateActivityEntry(e: unknown, idx: number): string | null {
  if (!e || typeof e !== "object") return `activity[${idx}]: not an object`;
  const o = e as Record<string, unknown>;
  if (typeof o["id"] !== "string" || !o["id"])            return `activity[${idx}].id: missing`;
  if (typeof o["agreementId"] !== "string")               return `activity[${idx}].agreementId: not a string`;
  if (typeof o["agreementName"] !== "string")             return `activity[${idx}].agreementName: not a string`;
  if (typeof o["action"] !== "string")                    return `activity[${idx}].action: not a string`;
  if (!isBigintPositiveOrZero(o["amount"]))                    return `activity[${idx}].amount: not a bigint`;
  if (o["actor"] !== "CLIENT" && o["actor"] !== "PROVIDER" && o["actor"] !== "SYSTEM") {
    return `activity[${idx}].actor: must be CLIENT, PROVIDER, or SYSTEM`;
  }
  if (!isBigintPositiveOrZero(o["scenarioTime"]))         return `activity[${idx}].scenarioTime: not a non-negative bigint`;
  return null;
}

export function loadActivity(): StorageResult<ActivityEntry[]> {
  const result = readKey<ActivityEntry[]>(KEY_ACTIVITY);
  if (!result.ok) return result;
  if (result.value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(result.value)) {
    const raw = safeGetItem(KEY_ACTIVITY);
    return { ok: false, error: "activityLog: not an array", raw: raw.ok ? raw.value : null };
  }
  for (let i = 0; i < result.value.length; i++) {
    const err = validateActivityEntry(result.value[i], i);
    if (err) {
      const raw = safeGetItem(KEY_ACTIVITY);
      return { ok: false, error: `Activity validation: ${err}`, raw: raw.ok ? raw.value : null };
    }
  }
  return result;
}

export function saveActivity(entries: ActivityEntry[]): StorageResult<void> {
  return writeKey(KEY_ACTIVITY, entries);
}

export function resetActivity(): void {
  safeRemoveItem(KEY_ACTIVITY);
}

// ── Role ──────────────────────────────────────────────────────────────────────

export function loadRole(): StorageResult<DemoRole> {
  const result = readKey<DemoRole>(KEY_ROLE);
  if (!result.ok) return result;
  const v = result.value;
  if (v === undefined) return { ok: true, value: "CLIENT" };
  if (v !== "CLIENT" && v !== "PROVIDER") return { ok: false, error: "Invalid role", raw: safeStringify(v) };
  return { ok: true, value: v };
}

export function saveRole(role: DemoRole): StorageResult<void> {
  return writeKey(KEY_ROLE, role);
}

// ── Namespace-scoped reset (confirmation required by caller UI) ───────────────
// Only removes keys with the "noticevault-demo-v1:" prefix.
// NEVER calls localStorage.clear().

export function resetDemoNamespace(): void {
  safeRemoveItem(KEY_AGREEMENTS);
  safeRemoveItem(KEY_CLOCK);
  safeRemoveItem(KEY_DRAFT);
  safeRemoveItem(KEY_ACTIVITY);
  safeRemoveItem(KEY_ROLE);
}

