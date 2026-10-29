/**
 * T-DRP — DraftReview entry-point preservation tests
 *
 * Verifies that the DraftReview rewrite did not remove any of the
 * component entry points that existed in the original implementation:
 *
 *   - WorkspacePanel (replaces inline SignIn — wraps wallet+sign-in+readiness)
 *   - Discovery (workspace/draft listing)
 *   - Authoring (draft creation/editing)
 *   - WorkspaceMembers (membership management)
 *   - PrivateRevisions (private draft revisions)
 *   - OperatorConsent (provider consent for a draft)
 *   - OperatorApproval (client approval, creation gate)
 *   - CreationApprovalReview (creation approval status)
 *   - TransactionReview (on-chain transaction status)
 *   - NotificationInbox (notifications)
 *   - IndexedAgreements (indexed agreement list)
 *   - Association (workspace–agreement association)
 *
 * Each test inspects the DraftReview source for the import statement,
 * confirming the module is still imported (and therefore still accessible).
 * This is a static-analysis regression guard — if a component is removed
 * from DraftReview, the corresponding test fails immediately.
 *
 * Secondary tests confirm the rendered HTML from the session section
 * (which is always visible) contains the expected controls.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DraftReview } from './DraftReview';

// ── Source-level preservation: all imports still present ──────────────────────

const draftReviewSource = readFileSync(
  resolve(import.meta.dirname, 'DraftReview.tsx'),
  'utf-8',
);

describe('DraftReview preserves all original component entry points (import-level)', () => {
  const requiredImports = [
    ['WorkspacePanel',         './WorkspacePanel'],
    ['Discovery',              './Discovery'],
    ['Authoring',              './Authoring'],
    ['WorkspaceMembers',       './WorkspaceMembers'],
    ['PrivateRevisions',       './PrivateRevisions'],
    ['OperatorConsent',        './OperatorConsent'],
    ['OperatorApproval',       './OperatorApproval'],
    ['CreationApprovalReview', './CreationApprovalReview'],
    ['TransactionReview',      './TransactionReview'],
    // NotificationInbox and IndexedAgreements may be default or named imports
    ['NotificationInbox',      './NotificationInbox'],
    ['IndexedAgreements',      './IndexedAgreements'],
    ['Association',            './Association'],
  ] as [string, string][];

  it.each(requiredImports)(
    'imports %s from %s',
    (name, modulePath) => {
      // Match either named { Foo } or default "import Foo" import from the module path.
      const namedImport = new RegExp(`\\{[^}]*${name}[^}]*\\}.*from\\s+['"]${modulePath}`);
      const defaultImport = new RegExp(`import\\s+${name}\\s+from\\s+['"]${modulePath}`);
      const found = namedImport.test(draftReviewSource) || defaultImport.test(draftReviewSource);
      expect(found, `Expected import of ${name} from ${modulePath} in DraftReview.tsx`).toBe(true);
    },
  );
});

// ── classifyRequestError is now extracted to request-error.ts ─────────────────

const requestErrorSource = readFileSync(
  resolve(import.meta.dirname, 'request-error.ts'),
  'utf-8',
);

describe('classifyRequestError is in request-error.ts (not inlined in DraftReview)', () => {
  it('DraftReview imports classifyRequestError from request-error module', () => {
    expect(draftReviewSource).toContain("from './request-error");
    expect(draftReviewSource).not.toMatch(/function classifyRequestError/);
  });

  it('request-error.ts exports classifyRequestError', () => {
    expect(requestErrorSource).toMatch(/export function classifyRequestError/);
  });
});

// ── WorkspacePanel is wired in and receives network prop ──────────────────────

describe('DraftReview wires network prop into WorkspacePanel', () => {
  it('DraftReview source passes network prop to WorkspacePanel', () => {
    expect(draftReviewSource).toContain('network={network}');
  });

  it('DraftReview loads AuthNetwork from loadAuthNetwork', () => {
    expect(draftReviewSource).toContain('loadAuthNetwork');
  });

  it('DraftReview no longer hardcodes "Arc Testnet chain 5042002" in static text', () => {
    // The string "Arc Testnet chain 5042002" was the old hardcoded subtitle.
    // It should be replaced by a dynamic expression using network state.
    expect(draftReviewSource).not.toContain('Arc Testnet chain 5042002');
  });
});

// ── Rendered session section always visible (no session required) ──────────────

describe('DraftReview — session section always rendered', () => {
  it('renders "Check existing session" button without a session', () => {
    const html = renderToStaticMarkup(React.createElement(DraftReview));
    expect(html).toContain('Check existing session');
  });

  it('renders workspace ID input field without a session', () => {
    const html = renderToStaticMarkup(React.createElement(DraftReview));
    expect(html).toContain('Workspace ID');
  });

  it('renders draft ID input field without a session', () => {
    const html = renderToStaticMarkup(React.createElement(DraftReview));
    expect(html).toContain('Draft ID');
  });

  it('renders "Load saved draft" button (disabled, no session)', () => {
    const html = renderToStaticMarkup(React.createElement(DraftReview));
    expect(html).toContain('Load saved draft');
  });

  it('renders the "Create an agreement. Keep the terms clear." heading', () => {
    const html = renderToStaticMarkup(React.createElement(DraftReview));
    expect(html).toContain('Create an agreement. Keep the terms clear.');
  });

  it('renders the "Backend workspace" label', () => {
    const html = renderToStaticMarkup(React.createElement(DraftReview));
    expect(html).toContain('Backend workspace');
  });
});

// ── WorkspacePanel network label not fabricated ───────────────────────────────

describe('DraftReview — no hardcoded network claim', () => {
  it('does not hardcode "Arc Testnet" as a literal string in source', () => {
    // Hardcoded literal strings for network identity are not allowed.
    // The configIdentity constant in deployments.ts is OK; a label in JSX is not.
    // The only acceptable reference is through network state or validated config.
    // We allow the configIdentity *value string* in import paths / type literals,
    // but reject it appearing in visible JSX text outside of a runtime expression.
    const hardcodedInJsx = />\s*Arc Testnet\s*</;
    expect(draftReviewSource).not.toMatch(hardcodedInJsx);
  });
});
