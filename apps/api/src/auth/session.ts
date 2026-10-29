/**
 * @noticevault/api — session management
 *
 * Sessions are DB-backed UUIDs stored in an HttpOnly, SameSite=Strict cookie.
 * No JWT. No client-side storage. Session revocation is immediate.
 *
 * CSRF protection:
 *  - SameSite=Strict for normal browser flows.
 *  - Origin/Referer header validation on state-mutating routes.
 *  - X-Requested-With: XMLHttpRequest header required on API routes.
 *
 * The session cookie value is a random UUID, not the session data.
 * All session data lives in the DB; the cookie is the lookup key.
 */

export const SESSION_COOKIE_NAME = "nv_session";
export const CSRF_HEADER_NAME    = "x-requested-with";
export const CSRF_HEADER_VALUE   = "XMLHttpRequest";

export interface SessionData {
  sessionId:     string;
  memberAddress: string;
  chainId:       bigint;
  workspaceId:   string | null;
  expiresAt:     Date;
}

/**
 * Build the Set-Cookie header value for the session cookie.
 * HttpOnly + SameSite=Strict + Secure (in production).
 */
export function buildSessionCookie(
  sessionId: string,
  expiresAt: Date,
  domain:    string,
  secure:    boolean,
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    `HttpOnly`,
    `SameSite=Strict`,
    `Path=/`,
    `Expires=${expiresAt.toUTCString()}`,
    `Domain=${domain}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Build the Set-Cookie header value that clears the session cookie.
 */
export function clearSessionCookie(domain: string): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    `HttpOnly`,
    `SameSite=Strict`,
    `Path=/`,
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    `Domain=${domain}`,
    `Max-Age=0`,
  ].join("; ");
}
