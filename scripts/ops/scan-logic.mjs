/** Production credential grammar. Every match is returned; no key or canary allowlist.
 * Offline tests construct inert grammar fixtures only in memory.
 * Matched values stay inside the scanner and must never be logged or published.
 */
export const SCAN_PATTERNS = [
  { name: 'GitHub token literal', re: /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/ },
  // Real credential service prefixes
  { name: 'sk_live_ credential',
    re: /sk_live_[A-Za-z0-9]{16,}/ },
  { name: 'sk_test_ credential',
    re: /sk_test_[A-Za-z0-9]{16,}/ },
  { name: 'Bearer token (long)',
    re: /Bearer [A-Za-z0-9._-]{32,}/ },
  // Token env assignments
  { name: 'Cloudflare API token env assignment',
    re: /(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN)\s*[=:]\s*[A-Za-z0-9_-]{20,}/ },
  { name: 'GitHub token env assignment',
    re: /GITHUB_TOKEN\s*[=:]\s*(?:ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9]{20,}/ },
  // Keyed HTTPS RPC endpoints
  { name: 'Alchemy / keyed HTTPS RPC URL',
    re: /https:\/\/[a-z0-9-]+\.(?:alchemyapi\.io|g\.alchemy\.com)\/v2\/[A-Za-z0-9_-]{20,}/ },
  // Private key in assignment context only — not bare hashes or math constants
  { name: 'Private key in assignment context',
    re: /(?:private[Kk]ey|signer[Kk]ey|PRIVATE_KEY|SECRET_KEY|SIGNING_KEY)\s*(?:=|:)\s*["']0x[0-9a-fA-F]{64}["']/ },
  // Database URL with embedded non-placeholder credentials
  { name: 'DATABASE_URL with non-placeholder credentials',
    re: /postgresql:\/\/(?!noticevault:noticevault_dev@)(?!\$\{)[^:]+:[^@]+@/ },
  // JWT/session secret assignments with real values
  { name: 'JWT/session secret assignment (non-placeholder)',
    re: /(?:JWT_SECRET|API_JWT_SECRET|SESSION_SECRET)\s*=\s*(?!REPLACE_WITH)(?!\$\{)[A-Za-z0-9_-]{16,}/ },
];

/** @param {string} line */
export function scanLine(line) {
  const hits = [];
  for (const { name, re } of SCAN_PATTERNS) {
    const match = re.exec(String(line));
    if (match) hits.push({ category: name, matchedValue: match[0] });
  }
  return hits;
}
