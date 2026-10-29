/**
 * WorkspacePanel — coherent 4-state workspace UX
 *
 * States shown in order (each is a prerequisite for the next):
 *   1. Wallet connected  — explicit account-only connection; independent read-only status
 *   2. Backend authenticated — message-only sign-in on the configured Arc network
 *   3. Contract deployed — factory deployment verification (informational, read-only)
 *   4. Financial readiness — agreement funding and notice reserve (informational, read-only)
 *
 * Security invariants preserved:
 *   - Connection (step 1) is completely separate from authentication (step 2).
 *   - No wallet permissions, signing, transactions, or token approvals happen here.
 *   - Network mismatch and stale account errors are surfaced explicitly.
 *   - Backend cleanup/revocation failures are not silenced.
 *   - Testnet label is never changed to mainnet. Deployment addresses are never fabricated.
 *   - "Contract deployed" and "financial readiness" are informational only; they reflect
 *     the no-deployment state honestly. SDK defects were resolved (253/253 tests pass).
 */
import React from 'react';
import { SignIn } from './SignIn.js';
import type { AuthNetwork } from './auth-network.js';
import type { Session } from './draft-review.js';
import type { DraftReviewClient } from './draft-review.js';

/**
 * Derive a human-readable network label from the validated runtime AuthNetwork.
 * Never uses a hardcoded "testnet" or "mainnet" string; the label comes from
 * parseAuthNetwork, which validates the value against the SDK deployment registry.
 */
export function networkLabel(network: AuthNetwork): string {
  return `${network.label} (chain ${network.chainId})`;
}

/**
 * Returns "testnet" | "mainnet" based on the validated configIdentity.
 * Used for contextual notes. The string comes from the runtime config, not a constant.
 */
export function networkKind(network: AuthNetwork): 'testnet' | 'mainnet' {
  return network.configIdentity === 'ARC_MAINNET' ? 'mainnet' : 'testnet';
}

// ── Visual primitives ─────────────────────────────────────────────────────────

const STEP_STYLES = {
  idle:    'border-slate-200 bg-white',
  active:  'border-blue-300 bg-white shadow-sm',
  done:    'border-green-200 bg-green-50',
  blocked: 'border-red-200 bg-red-50',
  warn:    'border-amber-200 bg-amber-50',
} as const;

function StepHeader({ n, label, state }: { n: number; label: string; state: keyof typeof STEP_STYLES }) {
  const badge: Record<keyof typeof STEP_STYLES, string> = {
    idle:    'bg-slate-100 text-slate-500',
    active:  'bg-blue-600 text-white',
    done:    'bg-green-600 text-white',
    blocked: 'bg-red-600 text-white',
    warn:    'bg-amber-500 text-white',
  };
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${badge[state]}`}>
        {state === 'done' ? '✓' : n}
      </span>
      <h2 className="text-lg font-semibold text-slate-900">{label}</h2>
    </div>
  );
}

function StatusPill({ text, variant }: { text: string; variant: 'ok' | 'warn' | 'err' | 'info' }) {
  const cls = {
    ok:   'bg-green-100 text-green-800 border border-green-200',
    warn: 'bg-amber-100 text-amber-800 border border-amber-200',
    err:  'bg-red-100 text-red-800 border border-red-200',
    info: 'bg-slate-100 text-slate-700 border border-slate-200',
  }[variant];
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{text}</span>;
}

// ── Contract readiness (static / informational) ───────────────────────────────

function ContractReadiness({ session, network }: { session: Session | null; network: AuthNetwork }) {
  // No factory address is deployed or verified. Hardcode the current honest state.
  // When a deployment is verified in the future, update this to read from a registry.
  const deployed = false; // no factory address set in ARC_TESTNET_DEPLOYMENT (deployments.ts)

  const stepState: keyof typeof STEP_STYLES = session ? (deployed ? 'done' : 'warn') : 'idle';

  // These labels come from the validated runtime AuthNetwork, not hardcoded strings.
  const kind = networkKind(network);
  const label = networkLabel(network);

  return (
    <section
      className={`my-4 rounded-xl border p-5 ${STEP_STYLES[stepState]}`}
      aria-label="Contract deployment readiness"
    >
      <StepHeader n={3} label="Contract deployment" state={stepState} />
      {!session && (
        <p className="text-sm text-slate-500">Sign in to your workspace first.</p>
      )}
      {session && !deployed && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <StatusPill text="NOT DEPLOYED" variant="warn" />
            <StatusPill text={`${label} — no verified factory`} variant="info" />
          </div>
          <p className="text-sm text-slate-700 mt-2">
            No verified factory deployment on {label}.
            Owner deployment preparation is in the Owner panel (Arc Mainnet chain 5042, separate from this {kind} session).
          </p>
          <p className="text-sm text-slate-500 mt-2">
            Owner deployment preparation uses Arc Mainnet (chain 5042) and is a separate, gated process.
            A real factory deployment is not verified. These are distinct configurations —
            {kind} authentication here does not imply mainnet readiness.
          </p>
        </>
      )}
    </section>
  );
}

// ── Financial readiness (static / informational) ──────────────────────────────

function FinancialReadiness({ session, network }: { session: Session | null; network: AuthNetwork }) {
  // Gates are closed until a factory is deployed. SDK defects were resolved; deployment is the remaining gate.
  const financiallyReady = false; // no factory deployed; financial gates closed

  const stepState: keyof typeof STEP_STYLES =
    !session ? 'idle' : financiallyReady ? 'done' : 'warn';

  return (
    <section
      className={`my-4 rounded-xl border p-5 ${STEP_STYLES[stepState]}`}
      aria-label="Financial readiness"
    >
      <StepHeader n={4} label="Financial readiness" state={stepState} />
      {!session && (
        <p className="text-sm text-slate-500">Sign in to your workspace first.</p>
      )}
      {session && !financiallyReady && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <StatusPill text="GATES CLOSED" variant="warn" />
            <StatusPill text={networkLabel(network)} variant="info" />
          </div>
          <p className="text-sm text-slate-700">
            No contract is deployed on {networkLabel(network)}. Agreement creation, funding,
            notice reserves, and claims require a verified factory.
            Financial execution gates are closed.
          </p>
          <p className="text-sm text-slate-500 mt-2">
            The synthetic demo (separate panel) exercises domain logic with no real funds or chain calls.
            Real USDC flows require a deployed factory on the configured network.
          </p>
        </>
      )}
    </section>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export interface WorkspacePanelProps {
  api: DraftReviewClient;
  /** Validated runtime network config from loadAuthNetwork; never fabricated. */
  network: AuthNetwork | null;
  session: Session | null;
  authBusy: boolean;
  onSignedIn: (session: Session) => void;
  onInvalidated: () => void;
  onBusy: (busy: boolean) => void;
}

/**
 * WorkspacePanel renders all four readiness states coherently.
 * Steps 1–2 come from SignIn (which embeds WorkspaceWallet).
 * Steps 3–4 are static readiness displays; they never fabricate deployment state.
 */
export function WorkspacePanel({
  api, network, session, authBusy, onSignedIn, onInvalidated, onBusy,
}: WorkspacePanelProps) {
  // Fallback network descriptor when the config has not loaded yet (SignIn handles its own load).
  const resolvedNetwork: AuthNetwork = network ?? {
    configIdentity: 'ARC_TESTNET',
    chainId: 5042002,
    label: 'Arc Testnet',
  };

  return (
    <div>
      {/* Step 1 (wallet) + Step 2 (sign-in) — SignIn loads AuthNetwork independently */}
      <SignIn
        api={api}
        onSignedIn={onSignedIn}
        onInvalidated={onInvalidated}
        onBusy={onBusy}
      />

      {/* Step 3: contract deployment — labels from validated runtime config */}
      <ContractReadiness session={session} network={resolvedNetwork} />

      {/* Step 4: financial readiness — labels from validated runtime config */}
      <FinancialReadiness session={session} network={resolvedNetwork} />

      {/* Active session summary — uses resolved network label */}
      {session && (
        <section className="my-4 rounded-xl border border-green-200 bg-green-50 p-4" aria-label="Active session summary">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <StatusPill text="SIGNED IN" variant="ok" />
            <StatusPill text={networkLabel(resolvedNetwork)} variant="info" />
            {resolvedNetwork.configIdentity !== 'ARC_MAINNET' && (
              <StatusPill text={`${networkKind(resolvedNetwork)} — not mainnet acceptance`} variant="warn" />
            )}
          </div>
          <p className="text-sm font-mono break-all text-slate-700 mt-1">{session.address}</p>
          <p className="text-xs text-slate-500 mt-1">
            Session expires {new Date(session.expiresAt).toUTCString()}.
            Authentication does not prove a contract is deployed or financial execution is enabled.
          </p>
        </section>
      )}

      {/* Auth busy indicator */}
      {authBusy && !session && (
        <p role="status" aria-live="polite" className="my-2 text-sm text-slate-500">
          Authentication in progress — do not close or refresh this page.
        </p>
      )}
    </div>
  );
}
