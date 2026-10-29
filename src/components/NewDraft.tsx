/**
 * NewDraft — create a synthetic agreement from human-readable inputs.
 *
 * Inputs: USDC decimal amounts (not micro-USDC), duration in days, UTC datetime strings.
 * All bigint conversions are exact (no floats). Scientific notation rejected.
 * Domain validators (validateTermsInput) run before review.
 * Draft is persisted to storage on every change; restored on remount.
 * Role is NOT hardcoded — client/provider addresses are entered by the user.
 */
import React, { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useDemoStore, useNavigate } from "../demo/DemoStore.js";
import type { DemoAgreement } from "../demo/types.js";
import { DEMO_CLIENT_ADDR, DEMO_PROVIDER_ADDR, DEMO_TOKEN_ADDR, DEMO_TOKEN_CTX } from "../demo/scenarios.js";
import { formatUsdcShort } from "../demo/projector.js";
import { createInitialState, computeR, validateTerms, assertUint256 } from "@noticevault/domain";
import type { AgreementTerms } from "@noticevault/domain";

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const USDC_DECIMAL_RE = /^\d+(\.\d{1,6})?$/; // e.g. "3000.00" or "3000"
const DAYS_RE = /^\d+(\.\d+)?$/;
const UTC_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/; // "2027-01-01T00:00"

// ── Parsing helpers ────────────────────────────────────────────────────────────

/** Parse "3000.00" USDC → 3000000000n micro-USDC. Rejects float math. */
function parseUsdcDecimal(s: string): bigint {
  if (!USDC_DECIMAL_RE.test(s.trim())) throw new Error("Invalid USDC amount");
  const [whole = "0", frac = ""] = s.trim().split(".");
  const fracPadded = frac.padEnd(6, "0").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded);
}

/** Parse days string → seconds bigint. */
function parseDays(s: string): bigint {
  if (!DAYS_RE.test(s.trim())) throw new Error("Invalid days");
  const [whole="0",fraction=""]=s.trim().split(".");
  const scale=10n**BigInt(fraction.length);
  const numerator=(BigInt(whole)*scale+BigInt(fraction||"0"))*86400n;
  if(numerator<=0n || numerator%scale!==0n) throw new Error("Days must represent a positive whole number of seconds");
  return numerator/scale;
}

/** Parse "2027-01-01T00:00" UTC → unix seconds bigint. */
function parseUtcDatetime(s: string): bigint {
  if (!UTC_DATE_RE.test(s.trim())) throw new Error("Must be YYYY-MM-DDTHH:MM");
  const d = new Date(s.trim() + ":00Z");
  if (isNaN(d.getTime()) || d.toISOString().slice(0,16)!==s.trim()) throw new Error("Invalid date");
  return BigInt(Math.floor(d.getTime() / 1000));
}

// ── Form field definitions ────────────────────────────────────────────────────

interface HumanField {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  type: "usdc" | "days" | "datetime" | "address" | "bytes32" | "integer";
  advanced?: boolean;
}

const HUMAN_FIELDS: HumanField[] = [
  { id: "client",              label: "Client address",          hint: "0x + 40 hex chars",                placeholder: DEMO_CLIENT_ADDR,  type: "address"  },
  { id: "provider",            label: "Provider address",        hint: "0x + 40 hex chars",                placeholder: DEMO_PROVIDER_ADDR, type: "address"  },
  { id: "amountPerPeriodUsdc", label: "Amount per period (USDC)", hint: "e.g. 3000.00 — up to 6 decimal places", placeholder: "3000.00",       type: "usdc"     },
  { id: "periodDays",          label: "Period duration (days)",   hint: "e.g. 30",                          placeholder: "30",              type: "days"     },
  { id: "noticeDays",          label: "Notice period (days)",     hint: "e.g. 30",                          placeholder: "30",              type: "days"     },
  { id: "startAt",             label: "Start date/time (UTC)",    hint: "YYYY-MM-DDTHH:MM",                 placeholder: "",                type: "datetime" },
  { id: "acceptanceDeadline",  label: "Acceptance deadline (UTC)", hint: "YYYY-MM-DDTHH:MM",               placeholder: "",                type: "datetime" },
  // Advanced fields
  { id: "token",               label: "Token address",            hint: "Must be allowlisted 6-decimal token", placeholder: DEMO_TOKEN_ADDR, type: "address", advanced: true },
  { id: "clientNonce",         label: "Client nonce",             hint: "Decimal integer ≥ 0",              placeholder: "0",               type: "integer", advanced: true },
  { id: "termsDocumentHash",   label: "Terms document hash",      hint: "0x + 64 hex chars",                placeholder: "0x" + "ab".repeat(32), type: "bytes32", advanced: true },
];

// ── Build default form values ─────────────────────────────────────────────────

function defaultValues(clockSeconds: bigint): Record<string, string> {
  const startDate = new Date((Number(clockSeconds) + 600) * 1000);
  const deadlineDate = new Date((Number(clockSeconds) + 3600) * 1000);
  const toLocal = (d: Date) => d.toISOString().slice(0, 16);
  return {
    client:              DEMO_CLIENT_ADDR,
    provider:            DEMO_PROVIDER_ADDR,
    amountPerPeriodUsdc: "3000.00",
    periodDays:          "30",
    noticeDays:          "30",
    startAt:             toLocal(startDate),
    acceptanceDeadline:  toLocal(deadlineDate),
    token:               DEMO_TOKEN_ADDR,
    clientNonce:         "0",
    termsDocumentHash:   "0x" + "cd".repeat(32),
  };
}

// ── Build AgreementTerms from form values ─────────────────────────────────────

function buildTerms(vals: Record<string, string>): AgreementTerms {
  return {
    schemaVersion: 1,
    client:            vals["client"]   ?? "",
    provider:          vals["provider"] ?? "",
    token:             vals["token"]    ?? DEMO_TOKEN_ADDR,
    amountPerPeriod:   parseUsdcDecimal(vals["amountPerPeriodUsdc"] ?? "0"),
    periodSeconds:     parseDays(vals["periodDays"] ?? "0"),
    noticeSeconds:     parseDays(vals["noticeDays"] ?? "0"),
    startAt:           parseUtcDatetime(vals["startAt"] ?? ""),
    acceptanceDeadline: parseUtcDatetime(vals["acceptanceDeadline"] ?? ""),
    clientNonce:       BigInt(vals["clientNonce"] ?? "0"),
    termsDocumentHash: vals["termsDocumentHash"] ?? "",
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateField(id: string, value: string): string | null {
  if (!value.trim()) return "Required";
  try {
    switch (id) {
      case "client": case "provider": case "token":
        if (!ADDR_RE.test(value)) return "Must be 0x + 40 hex chars";
        if (BigInt(value) === 0n) return "Must be non-zero address";
        return null;
      case "amountPerPeriodUsdc":
        parseUsdcDecimal(value);
        if (parseUsdcDecimal(value) === 0n) return "Amount must be greater than zero";
        return null;
      case "periodDays": case "noticeDays":
        parseDays(value);
        return null;
      case "startAt": case "acceptanceDeadline":
        parseUtcDatetime(value);
        return null;
      case "clientNonce":
        if (!/^\d+$/.test(value.trim())) return "Must be a non-negative integer";
        assertUint256(BigInt(value.trim()), "clientNonce");
        return null;
      case "termsDocumentHash":
        if (!HASH_RE.test(value)) return "Must be 0x + 64 hex chars";
        return null;
      default:
        return null;
    }
  } catch (err) {
    return String(err);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NewDraft() {
  const { state, dispatch } = useDemoStore();
  const { back, toAgreement } = useNavigate();
  const clock = state.clock;

  const defaults = defaultValues(clock);

  // Restore persisted draft or use defaults.
  const [name, setName] = useState(state.draft?.name ?? "");
  const [vals, setVals] = useState<Record<string, string>>(() => {
    if (state.draft?.fields) {
      // Merge persisted fields with defaults for any missing fields.
      return Object.fromEntries(HUMAN_FIELDS.map(f => [f.id, (state.draft?.fields as Record<string, string | undefined>)[f.id] ?? defaults[f.id] ?? ""]));
    }
    return defaults;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [domainError, setDomainError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Persist draft on change (debounced via useEffect).
  useEffect(() => {
    if (state.role!=="CLIENT") return;
    dispatch({
      type: "SET_DRAFT",
      draft: { name, fields: vals },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, vals, state.role, dispatch]);

  const setField = useCallback((id: string, value: string) => {
    setVals(prev => ({ ...prev, [id]: value }));
    // Clear individual field error on change.
    setErrors(prev => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
    setDomainError(null);
  }, []);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs["name"] = "Required";

    for (const f of HUMAN_FIELDS) {
      const e = validateField(f.id, vals[f.id] ?? "");
      if (e) errs[f.id] = e;
    }
    // Cross-field: client !== provider
    if (vals["client"] && vals["provider"] && vals["client"].toLowerCase() === vals["provider"].toLowerCase()) {
      errs["provider"] = "Must differ from client";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) return false;

    // Domain validation using SDK/domain validators.
    try {
      const terms = buildTerms(vals);
      // Use clock as creationNow — demo agreements start relative to current scenario time.
      validateTerms(terms, clock, DEMO_TOKEN_CTX);
      setDomainError(null);
      return true;
    } catch (err) {
      setDomainError(String(err));
      return false;
    }
  };

  const handleReview = () => {
    if (validate()) setReviewing(true);
  };

  const handleAccept = () => {
    let terms: AgreementTerms;
    try {
      terms = buildTerms(vals);
      validateTerms(terms, clock, DEMO_TOKEN_CTX);
    } catch (err) {
      setDomainError(String(err));
      setReviewing(false);
      return;
    }
    const state0 = createInitialState(terms);
    const newAgreement: DemoAgreement = {
      id: crypto.randomUUID(),
      name: name.trim() || "Untitled agreement",
      state: state0,
      eventLog: [],
      createdAt: clock,
    };
    const result=dispatch({ type: "ADD_AGREEMENT", agreement: newAgreement });
    if (!result.ok) {setDomainError(result.reason);return;}
    toAgreement(newAgreement.id);
  };

  if (state.role !== "CLIENT") return <div className="p-6" role="alert">Switch to Client to create a synthetic agreement.</div>;

  if (reviewing) {
    let terms: AgreementTerms | null = null;
    let R = 0n, totalInflow = 0n;
    try {
      terms = buildTerms(vals);
      R = computeR(terms);
      totalInflow = terms.amountPerPeriod + R;
    } catch { /* shown as domainError */ }

    return (
      <div className="p-6 max-w-2xl mx-auto">
        <button onClick={() => setReviewing(false)} className="flex items-center gap-2 text-slate-400 hover:text-slate-700 text-sm mb-4">
          <ArrowLeft size={14} /> Back to draft
        </button>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Review terms</h1>
        <p className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded p-3 mb-5">
          <strong>SIMULATION ONLY</strong> — accepting this draft creates a synthetic local agreement.
          No real wallet signing, token transfer, or on-chain action occurs.
        </p>

        {domainError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            Domain validation: {domainError}
          </div>
        )}

        {terms && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-4">
            <div className="font-semibold text-slate-800 mb-3">{name}</div>
            <div className="space-y-0">
              <ReviewRow label="Client" value={terms.client} mono />
              <ReviewRow label="Provider" value={terms.provider} mono />
              <ReviewRow label="Token" value={terms.token} mono />
              <ReviewRow label="Amount per period (A)" value={`$${formatUsdcShort(terms.amountPerPeriod)} USDC`} />
              <ReviewRow label="Period (P)" value={`${Number(terms.periodSeconds) / 86400} days`} />
              <ReviewRow label="Notice period (N)" value={`${Number(terms.noticeSeconds) / 86400} days`} />
              <ReviewRow label="Start (t0)" value={new Date(Number(terms.startAt) * 1000).toISOString().slice(0, 19) + " UTC"} />
              <ReviewRow label="Acceptance deadline" value={new Date(Number(terms.acceptanceDeadline) * 1000).toISOString().slice(0, 19) + " UTC"} />
              <ReviewRow label="Notice reserve (R, computed)" value={`$${formatUsdcShort(R)} USDC`} mono />
              <ReviewRow label="Total initial inflow (A+R)" value={`$${formatUsdcShort(totalInflow)} USDC`} highlight />
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button onClick={() => setReviewing(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 hover:bg-slate-50 min-h-[44px]">
            Edit
          </button>
          <button onClick={handleAccept} disabled={!terms} className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium min-h-[44px]">
            Simulate acceptance
          </button>
        </div>
      </div>
    );
  }

  const primaryFields = HUMAN_FIELDS.filter(f => !f.advanced);
  const advancedFields = HUMAN_FIELDS.filter(f => f.advanced);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button onClick={back} className="flex items-center gap-2 text-slate-400 hover:text-slate-700 text-sm mb-4">
        <ArrowLeft size={14} /> Back
      </button>
      <h1 className="text-xl font-bold text-slate-900 mb-1">New draft agreement</h1>
      <p className="text-sm text-slate-500 mb-5">
        Amounts in USDC (decimal). Durations in days. Dates in UTC.
      </p>

      {domainError && (
        <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Domain validation: {domainError}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        {/* Agreement name */}
        <FormField
          label="Agreement name"
          hint="Human-readable label for this agreement"
          error={errors["name"]}
        >
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className={inputCls(!!errors["name"])}
            placeholder="e.g. Protocol Services Q1 2027"
          />
        </FormField>

        {/* Primary fields */}
        {primaryFields.map(f => (
          <FormField key={f.id} label={f.label} hint={errors[f.id] ?? f.hint} error={errors[f.id]}>
            <input
              type={f.type === "datetime" ? "datetime-local" : "text"}
              value={vals[f.id] ?? ""}
              onChange={e => setField(f.id, e.target.value)}
              className={inputCls(!!errors[f.id])}
              placeholder={f.placeholder}
            />
          </FormField>
        ))}

        {/* Advanced fields (collapsible) */}
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
        >
          {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Advanced fields
        </button>

        {showAdvanced && advancedFields.map(f => (
          <FormField key={f.id} label={f.label} hint={errors[f.id] ?? f.hint} error={errors[f.id]}>
            <input
              type="text"
              value={vals[f.id] ?? ""}
              onChange={e => setField(f.id, e.target.value)}
              className={`${inputCls(!!errors[f.id])} font-mono`}
              placeholder={f.placeholder}
            />
          </FormField>
        ))}
      </div>

      <div className="flex justify-end mt-4 gap-3">
        <button onClick={back} className="px-4 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 hover:bg-slate-50 min-h-[44px]">
          Cancel
        </button>
        <button onClick={handleReview} className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium min-h-[44px]">
          Review terms
        </button>
      </div>
    </div>
  );
}

function inputCls(error: boolean): string {
  return `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${error ? "border-red-400 bg-red-50" : "border-slate-200"}`;
}

function FormField({ label, hint, error, children }: {
  label: string; hint: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {hint && (
        <p className={`text-xs mt-1 ${error ? "text-red-600" : "text-slate-400"}`}>{hint}</p>
      )}
    </div>
  );
}

function ReviewRow({ label, value, mono, highlight }: {
  label: string; value: string; mono?: boolean; highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-slate-50 last:border-0 gap-4">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={`text-sm text-right break-all ${mono ? "font-mono text-xs" : ""} ${highlight ? "font-semibold text-blue-700" : "text-slate-700"}`}>
        {value}
      </span>
    </div>
  );
}

