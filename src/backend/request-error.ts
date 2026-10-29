/**
 * classifyRequestError — request-path error classifier.
 *
 * Converts an unknown caught error into a human-readable message for display.
 * Cleanup/sign-out failures are never silenced.
 * AbortError (user-initiated cancel) returns empty string — caller must not
 * overwrite state with a cancel message.
 *
 * Extracted from DraftReview so it can be unit-tested independently.
 */
import { ReviewError } from './draft-review.js';

export function classifyRequestError(e: unknown, context: string): string {
  if (e instanceof ReviewError) {
    switch (e.status) {
      case 401:
        return `Your session is missing or expired (${context}). Check the session status, then sign in again through the wallet flow.`;
      case 403:
        return `Access denied (${context}). Your authenticated account does not have access to that workspace.`;
      case 404:
        return `Not found (${context}). Check the workspace and draft IDs; they are case-sensitive UUIDs.`;
      case 400:
        return `Invalid request (${context}). Check that the workspace and draft IDs are correctly formatted UUIDs.`;
      case 0:
        return `Network unreachable (${context}). The backend could not be contacted. Check your connection and whether the API is running.`;
      case 502:
        return `Unexpected backend response (${context}). The API returned an unrecognised format. No data was changed.`;
      case 503:
        return `Backend unavailable (${context}). The server may be starting up or restarting. Wait a moment, then retry.`;
      default:
        return `Backend error ${e.status} (${context}). ${e.message}`;
    }
  }
  if (e instanceof Error) {
    if (e.name === 'AbortError') return '';
    if (
      e.message.includes('cleanup') ||
      e.message.includes('sign-out') ||
      e.message.includes('Sign-out')
    ) {
      return `Session cleanup could not be confirmed (${context}). Use "Sign out" before signing in again. No session was accepted.`;
    }
    return e.message;
  }
  return `Unexpected error (${context}). Please retry.`;
}
