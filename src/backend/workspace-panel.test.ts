/**
 * T-WP — WorkspacePanel unit tests
 *
 * Covers:
 *   - networkLabel / networkKind: derived from validated AuthNetwork, not hardcoded strings
 *   - ContractReadiness + FinancialReadiness step states for null vs present session
 *   - Static markup: disconnected, connected-but-not-authenticated, authenticated, wrong-chain
 *   - Auth revocation / cleanup failure text
 *   - No-deployment state: "NOT DEPLOYED" label present, no fabricated address
 *   - Financial gates closed when no session
 *   - Mainnet config produces mainnet labels, not testnet
 *   - WorkspacePanel does not conflate wallet connection with authentication
 *
 * All tests are pure unit / SSR (renderToStaticMarkup). No real wallet calls.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WorkspacePanel,
  networkLabel,
  networkKind,
} from './WorkspacePanel';
import type { WorkspacePanelProps } from './WorkspacePanel';
import type { AuthNetwork } from './auth-network';
import type { Session } from './draft-review';
import { DraftReviewClient } from './draft-review';

// ── Shared fixtures ────────────────────────────────────────────────────────────

const testnetNetwork: AuthNetwork = {
  configIdentity: 'ARC_TESTNET',
  chainId: 5042002,
  label: 'Arc Testnet',
};

const mainnetNetwork: AuthNetwork = {
  configIdentity: 'ARC_MAINNET',
  chainId: 5042,
  label: 'Arc Mainnet',
};

const testnetSession: Session = {
  address: '0x' + '11'.repeat(20),
  chainId: '5042002',
  workspaceId: null,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
};

const mainnetSession: Session = {
  address: '0x' + '22'.repeat(20),
  chainId: '5042',
  workspaceId: null,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
};

const api = new DraftReviewClient(() => Promise.resolve(new Response('{}', { status: 503 })));

function render(props: Partial<WorkspacePanelProps> = {}) {
  const defaults: WorkspacePanelProps = {
    api,
    network: testnetNetwork,
    session: null,
    authBusy: false,
    onSignedIn: () => {},
    onInvalidated: () => {},
    onBusy: () => {},
  };
  return renderToStaticMarkup(
    React.createElement(WorkspacePanel, { ...defaults, ...props }),
  );
}

// ── networkLabel and networkKind: derived from runtime config ──────────────────

describe('networkLabel and networkKind derive from validated AuthNetwork', () => {
  it('testnet produces label containing "Arc Testnet" and chain 5042002', () => {
    const label = networkLabel(testnetNetwork);
    expect(label).toContain('Arc Testnet');
    expect(label).toContain('5042002');
  });

  it('mainnet produces label containing "Arc Mainnet" and chain 5042', () => {
    const label = networkLabel(mainnetNetwork);
    expect(label).toContain('Arc Mainnet');
    expect(label).toContain('5042');
  });

  it('testnet kind is "testnet"', () => {
    expect(networkKind(testnetNetwork)).toBe('testnet');
  });

  it('mainnet kind is "mainnet"', () => {
    expect(networkKind(mainnetNetwork)).toBe('mainnet');
  });

  it('networkLabel does not hardcode a chain ID regardless of input', () => {
    // A hypothetical future network with a different ID should produce the correct label.
    const custom: AuthNetwork = { configIdentity: 'ARC_TESTNET', chainId: 99999, label: 'Custom Net' };
    const label = networkLabel(custom);
    expect(label).toContain('99999');
    expect(label).toContain('Custom Net');
    expect(label).not.toContain('5042002'); // must not hardcode the testnet chain
  });
});

// ── Disconnected state ─────────────────────────────────────────────────────────

describe('WorkspacePanel — disconnected (no session, no wallet)', () => {
  it('renders step 3 (contract) in idle state with "sign in first" message', () => {
    const html = render({ session: null, network: testnetNetwork });
    expect(html).toContain('Contract deployment');
    expect(html).toContain('GATES CLOSED');
  });

  it('renders step 4 (financial) in idle state with "sign in first" message', () => {
    const html = render({ session: null, network: testnetNetwork });
    expect(html).toContain('Financial readiness');
    expect(html).toContain('GATES CLOSED');
  });

  it('does not show SIGNED IN pill when no session', () => {
    const html = render({ session: null, network: testnetNetwork });
    expect(html).not.toContain('SIGNED IN');
  });

  it('does not show a fabricated factory address', () => {
    const html = render({ session: null, network: testnetNetwork });
    // No Ethereum address should appear in deployment claims
    expect(html).not.toMatch(/0x[0-9a-fA-F]{40}/); // no fake address
  });
});

// ── Authenticated state ────────────────────────────────────────────────────────

describe('WorkspacePanel — authenticated (session present)', () => {
  it('shows SIGNED IN pill', () => {
    const html = render({ session: testnetSession, network: testnetNetwork });
    expect(html).toContain('SIGNED IN');
  });

  it('shows NOT DEPLOYED in contract readiness step', () => {
    const html = render({ session: testnetSession, network: testnetNetwork });
    expect(html).toContain('NOT DEPLOYED');
  });

  it('shows GATES CLOSED in financial readiness step', () => {
    const html = render({ session: testnetSession, network: testnetNetwork });
    expect(html).toContain('GATES CLOSED');
  });

  it('includes the session address in the summary', () => {
    const html = render({ session: testnetSession, network: testnetNetwork });
    expect(html).toContain(testnetSession.address);
  });

  it('shows session expiry in the summary', () => {
    const html = render({ session: testnetSession, network: testnetNetwork });
    expect(html).toContain('Session expires');
  });
});

// ── Network label correctness ──────────────────────────────────────────────────

describe('WorkspacePanel — network labels come from validated runtime config', () => {
  it('testnet session shows Arc Testnet label in session summary', () => {
    const html = render({ session: testnetSession, network: testnetNetwork });
    expect(html).toContain('Arc Testnet');
    expect(html).toContain('5042002');
    // The session summary section must label the session as testnet, not mainnet.
    // Note: "Arc Mainnet" may still appear in explanatory prose about the separate owner panel,
    // but the session-summary aria section itself must say "Arc Testnet".
    const summaryStart = html.indexOf('aria-label="Active session summary"');
    expect(summaryStart).toBeGreaterThan(-1);
    const summarySnippet = html.slice(summaryStart, summaryStart + 600);
    expect(summarySnippet).toContain('Arc Testnet');
    expect(summarySnippet).not.toContain('Arc Mainnet');
  });

  it('mainnet session shows Arc Mainnet label in session summary and contract readiness', () => {
    const html = render({ session: mainnetSession, network: mainnetNetwork });
    expect(html).toContain('Arc Mainnet');
    expect(html).toContain('5042');
    // The session summary section must label the session as mainnet.
    const summaryStart = html.indexOf('aria-label="Active session summary"');
    if (summaryStart > -1) {
      const summarySnippet = html.slice(summaryStart, summaryStart + 600);
      expect(summarySnippet).not.toContain('Arc Testnet (chain 5042002)');
    }
  });

  it('testnet shows "testnet — not mainnet acceptance" note', () => {
    const html = render({ session: testnetSession, network: testnetNetwork });
    expect(html).toContain('not mainnet acceptance');
  });

  it('mainnet does NOT show "not mainnet acceptance" testnet note', () => {
    // When configured for mainnet, the testnet-specific warning is absent.
    const html = render({ session: mainnetSession, network: mainnetNetwork });
    expect(html).not.toContain('not mainnet acceptance');
  });

  it('contract readiness label uses network.label, not hardcoded string', () => {
    const custom: AuthNetwork = { configIdentity: 'ARC_TESTNET', chainId: 99999, label: 'Custom Network' };
    const session: Session = { ...testnetSession, chainId: '99999' };
    const html = render({ session, network: custom });
    expect(html).toContain('Custom Network');
    expect(html).not.toContain('Arc Testnet'); // custom network, not the constant
  });

  it('financial readiness label uses network.label', () => {
    const html = render({ session: mainnetSession, network: mainnetNetwork });
    expect(html).toContain('Arc Mainnet');
  });
});

// ── Null network fallback ──────────────────────────────────────────────────────

describe('WorkspacePanel — null network (config not yet loaded)', () => {
  it('renders without crashing when network is null', () => {
    // Should not throw; uses the internal fallback ARC_TESTNET descriptor.
    expect(() => render({ session: null, network: null })).not.toThrow();
  });

  it('null network with session does not invent a network', () => {
    const html = render({ session: testnetSession, network: null });
    expect(html).toContain('NETWORK UNAVAILABLE');
    expect(html).not.toContain('Arc Testnet');
  });
});

// ── Auth busy state ────────────────────────────────────────────────────────────

describe('WorkspacePanel — auth busy indicator', () => {
  it('shows "Authentication in progress" when authBusy and no session', () => {
    const html = render({ session: null, authBusy: true, network: testnetNetwork });
    expect(html).toContain('Authentication in progress');
  });

  it('does NOT show auth busy indicator when already signed in', () => {
    // When session is present, the busy indicator is suppressed.
    const html = render({ session: testnetSession, authBusy: true, network: testnetNetwork });
    expect(html).not.toContain('Authentication in progress');
  });
});

// ── No fabricated deployment addresses ────────────────────────────────────────

describe('WorkspacePanel — no fabricated deployment state', () => {
  it('does not claim factory is deployed when session present', () => {
    const html = render({ session: testnetSession, network: testnetNetwork });
    expect(html).toContain('NOT DEPLOYED');
    // The pill text is always "NOT DEPLOYED" — there must be no separate "DEPLOYED" success pill.
    // Regex: check there is no "DEPLOYED" span that is NOT preceded by "NOT ".
    expect(html).not.toMatch(/(?<!NOT )DEPLOYED<\/span>/);
    expect(html).not.toContain('0x000'); // no zero address
  });

  it('contract readiness note mentions separate owner panel for Arc Mainnet', () => {
    const html = render({ session: testnetSession, network: testnetNetwork });
    expect(html).toContain('Arc Mainnet');
    expect(html).toContain('must not be deployed again');
  });

  it('financial gates closed note mentions "deployed factory"', () => {
    const html = render({ session: testnetSession, network: testnetNetwork });
    expect(html).toContain('deployed factory');
  });
});

 describe('mainnet deployment record',()=>{it('shows the exact verified factory while financial gates remain closed',()=>{const html=render({session:mainnetSession,network:mainnetNetwork});expect(html).toContain('DEPLOYMENT RECORDED');expect(html).toContain('0x801c366eb4e07162fca1f260d78338a3433d81e2');expect(html).toContain('GATES CLOSED');expect(html).not.toContain('NOT DEPLOYED');});});
