import React from 'react';
import {arcDeployment} from '../../packages/sdk/src/deployments';
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

function ContractReadiness({ network }: { session: Session | null; network: AuthNetwork | null }) {
  const deployment = network ? arcDeployment(network.configIdentity) : null;
  const address = deployment?.chainId === BigInt(network?.chainId ?? 0) ? deployment.factoryAddress : null;
  return <section className="my-4 rounded-xl border border-slate-200 bg-white p-5" aria-label="Contract deployment readiness">
    <h2 className="text-lg font-semibold">Contract deployment</h2>
    <div className="my-3"><StatusPill text={!network?'NETWORK UNAVAILABLE':address?'DEPLOYMENT RECORDED':'NOT DEPLOYED'} variant={address?'info':'warn'}/></div>
    {!network?<p>Workspace network is unavailable. No network or deployment is assumed.</p>:address?<><p>Verified deployment recorded for {networkLabel(network)}.</p><a className="block break-all underline text-teal-700" href={`https://explorer.arc.io/address/${address}`} target="_blank" rel="noreferrer">{address}</a><p className="mt-3 text-sm text-slate-600">This is historical deployment evidence. Use Mainnet overview for a fresh read; deployment does not enable financial execution.</p></>:<p>No verified factory is configured for {networkLabel(network)}. The separate Arc Mainnet factory is already deployed; it must not be deployed again.</p>}
  </section>;
}
function FinancialReadiness({ network }: { session: Session | null; network: AuthNetwork | null }) {
  return <section className="my-4 rounded-xl border border-amber-200 bg-amber-50 p-5" aria-label="Financial readiness">
    <h2 className="text-lg font-semibold">Financial readiness</h2><div className="my-3"><StatusPill text="GATES CLOSED" variant="warn"/></div>
    <p>Financial execution remains disabled. A deployed factory alone does not activate agreement funding, notice reserves or claims.</p>
    <p className="mt-3 text-sm text-slate-600">Resolve the public-site wallet warning, review operator configuration and indexing, and complete the owner-operated proof before activation. {network?`Workspace: ${networkLabel(network)}.`:'Workspace network is unavailable.'}</p>
  </section>;
}

// ── Main panel ────────────────────────────────────────────────────────────────

export interface WorkspacePanelProps {
  api: DraftReviewClient;
  /** Validated runtime network config from loadAuthNetwork; never fabricated. */
  network: AuthNetwork | null;
  onNetwork?: (network: AuthNetwork | null) => void;
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
  api, network, session, authBusy, onSignedIn, onInvalidated, onBusy, onNetwork,
}: WorkspacePanelProps) {
  const resolvedNetwork = network;

  return (
    <div>
      {/* Step 1 (wallet) + Step 2 (sign-in) — SignIn loads AuthNetwork independently */}
      <SignIn
        api={api}
        onNetwork={onNetwork}
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
            <StatusPill text={resolvedNetwork?networkLabel(resolvedNetwork):`Session chain ${session.chainId} — backend network unavailable`} variant="info" />
            {resolvedNetwork && resolvedNetwork.configIdentity !== 'ARC_MAINNET' && (
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
