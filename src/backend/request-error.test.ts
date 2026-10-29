/**
 * T-RE — classifyRequestError unit tests
 *
 * classifyRequestError is the request-path error classifier in DraftReview.tsx.
 * It is not exported, so we test it through a re-implementation of the exact
 * same logic in a shared helper, which DraftReview.tsx should import.
 *
 * To avoid duplicating the implementation, we extract it to a dedicated module
 * and import from there. If DraftReview.tsx still inlines it, these tests
 * serve as a specification and catch any divergence via the preservation test.
 *
 * Covers:
 *   - All named ReviewError status codes (401, 403, 404, 400, 0, 502, 503)
 *   - Unknown numeric status codes
 *   - AbortError → empty string (not shown to user)
 *   - Cleanup/sign-out failure keyword → specific cleanup message
 *   - Generic Error → message passthrough
 *   - Non-Error thrown value → generic fallback
 */
import { describe, it, expect } from 'vitest';
import { classifyRequestError } from './request-error';
import { ReviewError } from './draft-review';

describe('classifyRequestError — ReviewError status codes', () => {
  it.each([
    [401, 'session', 'session is missing or expired'],
    [403, 'workspace', 'does not have access'],
    [404, 'loading draft', 'Not found'],
    [400, 'loading draft', 'Invalid request'],
    [0,   'network',  'could not be contacted'],
    [502, 'session',  'unrecognised format'],
    [503, 'session',  'unavailable'],
  ] as [number, string, string][])(
    'status %d in context "%s" contains "%s"',
    (status, context, substring) => {
      const msg = classifyRequestError(new ReviewError(status), context);
      expect(msg.toLowerCase()).toContain(substring.toLowerCase());
      expect(msg).toContain(context);
    },
  );

  it('unknown status code includes the numeric code', () => {
    const msg = classifyRequestError(new ReviewError(429), 'rate-limit-test');
    expect(msg).toContain('429');
    expect(msg).toContain('rate-limit-test');
  });
});

describe('classifyRequestError — AbortError suppressed', () => {
  it('returns empty string for AbortError (user-initiated cancel)', () => {
    const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(classifyRequestError(err, 'loading draft')).toBe('');
  });

  it('returns empty string for DOMException with AbortError name', () => {
    // DOMException.name is a read-only getter; construct it correctly via the constructor.
    const err = new DOMException('Aborted', 'AbortError');
    // DOMException constructor sets name automatically from the second argument.
    expect(err.name).toBe('AbortError');
    expect(classifyRequestError(err, 'loading draft')).toBe('');
  });
});

describe('classifyRequestError — cleanup/sign-out failures', () => {
  it('cleanup failure surfaces specific message when "cleanup" keyword present', () => {
    const err = new Error('Sign-in failed and session cleanup could not be confirmed. Use Sign out and retry.');
    const msg = classifyRequestError(err, 'sign-in');
    expect(msg).toContain('cleanup could not be confirmed');
    expect(msg).toContain('sign-in');
  });

  it('sign-out failure surfaces specific message when "sign-out" keyword present', () => {
    const err = new Error('Session sign-out failed; please retry.');
    const msg = classifyRequestError(err, 'sign-out');
    expect(msg).toContain('cleanup could not be confirmed');
    expect(msg).toContain('sign-out');
  });

  it('cleanup message is not silenced — contains actionable retry instruction', () => {
    const err = new Error('cleanup failed');
    const msg = classifyRequestError(err, 'ctx');
    expect(msg.length).toBeGreaterThan(0);
    // Must not return empty string (cleanup failures must surface)
    expect(msg).not.toBe('');
  });
});

describe('classifyRequestError — generic Error passthrough', () => {
  it('passes through a generic Error message that does not match keyword patterns', () => {
    const err = new Error('Wallet account or network changed. Start sign-in again.');
    const msg = classifyRequestError(err, 'sign-in');
    expect(msg).toContain('Wallet account or network changed');
  });

  it('passes through user-visible rejection message (code 4001)', () => {
    const err = new Error('Signing was declined. No session was accepted.');
    const msg = classifyRequestError(err, 'sign-in');
    expect(msg).toContain('declined');
  });
});

describe('classifyRequestError — non-Error fallback', () => {
  it('returns generic fallback for thrown string', () => {
    const msg = classifyRequestError('something weird', 'test-context');
    expect(msg).toContain('Unexpected error');
    expect(msg).toContain('test-context');
  });

  it('returns generic fallback for null', () => {
    const msg = classifyRequestError(null, 'test-context');
    expect(msg).toContain('Unexpected error');
  });

  it('returns generic fallback for plain object', () => {
    const msg = classifyRequestError({ code: 500 }, 'test-context');
    expect(msg).toContain('Unexpected error');
  });
});
