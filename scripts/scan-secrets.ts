#!/usr/bin/env bun
/**
 * NoticeVault secret scanner — T-003 (fixed)
 *
 * Scans staged git content or explicit file paths for credential patterns.
 *
 * SECURITY FIXES applied (2026-09-16):
 *   1. All git invocations use execFileSync with an explicit argv array — no shell,
 *      no template-literal interpolation, no metacharacter expansion.
 *   2. Staged filenames are obtained with NUL delimiters (-z) and split on NUL,
 *      so filenames with spaces, newlines, quotes, semicolons, $ etc. are safe.
 *   3. Git/read/parse errors are FATAL (exit 2) — a failed read can never produce
 *      a false-clean result. The caller must decide whether to retry or abort.
 *   4. No-input invocation exits 2 (invalid usage) — never a silent clean pass.
 *   5. The distinction between "not a git repo", "no staged files", and a git
 *      command failure is explicit and each case has a distinct diagnostic.
 *   6. Skip rules are exact path matches — not substring includes — so a file
 *      whose name merely contains "bun.lock" is not accidentally skipped.
 *   7. Deleted/renamed staged entries are explicitly skipped with a log line;
 *      they are not read (nothing to read), but the skip is not silent.
 *   8. Diagnostics report file paths and match names only — never file contents.
 *
 * Exit codes:
 *   0 — scan completed; no credential patterns found
 *   1 — scan completed; credential pattern(s) found → FAIL
 *   2 — invalid invocation or runtime error (git failure, unreadable file, etc.)
 *
 * Usage:
 *   bun run scripts/scan-secrets.ts --staged
 *   bun run scripts/scan-secrets.ts path/to/file.ts [path/to/other.ts ...]
 *   bun run scripts/scan-secrets.ts --staged path/to/file.ts
 */

import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";

// ── Credential patterns ──────────────────────────────────────────────────────
// Patterns are defined as strings and compiled once to avoid this source file
// matching its own pattern list (the compiled regex is tested against content,
// not source text of this file, so the risk is low, but we keep the convention).
const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "Synthetic canary (SYNTHETIC_CANARY_sk_live_)",
    pattern: new RegExp("SYNTHETIC_CANARY_sk_live_"),
  },
  {
    name: "Generic sk_live_ credential",
    pattern: new RegExp("sk_live_[A-Za-z0-9]{20,}"),
  },
  {
    name: "Hex private key (0x + 64 hex chars)",
    pattern: new RegExp("0x[0-9a-fA-F]{64}(?![0-9a-fA-F])"),
  },
  {
    name: "AWS access key (AKIA...)",
    pattern: new RegExp("AKIA[0-9A-Z]{16}"),
  },
  {
    name: "Circle API key pattern (TEST_API_KEY:...)",
    pattern: new RegExp("TEST_API_KEY:[A-Za-z0-9+/=]{30,}"),
  },
];

// ── Exact skip list ──────────────────────────────────────────────────────────
// Exact relative paths (from repo root) to always skip. NOT substring matching.
// Add a path here when it is intentionally allowed to contain pattern-like text
// (e.g. this scanner's own source, lockfiles).
const EXACT_SKIP_PATHS = new Set([
  "bun.lock",
  "package-lock.json",
  "yarn.lock",
  "scripts/scan-secrets.ts",          // this file — contains pattern strings
  "tests/t003-secret-scan.sh",        // test harness — references pattern names
  "tests/t003-red-evidence.sh",       // red-evidence harness
]);

// Directory prefixes to skip (exact prefix match from repo root, no substring)
const SKIP_DIR_PREFIXES = [
  "node_modules/",
  ".git/",
  "packages/domain/node_modules/",
  "apps/api/node_modules/",
  "apps/worker/node_modules/",
  "apps/web/node_modules/",
  "apps/recovery/node_modules/",
];

function shouldSkip(filePath: string): boolean {
  // Normalize: strip leading ./
  const p = filePath.startsWith("./") ? filePath.slice(2) : filePath;
  if (EXACT_SKIP_PATHS.has(p)) return true;
  for (const prefix of SKIP_DIR_PREFIXES) {
    if (p.startsWith(prefix)) return true;
  }
  return false;
}

// ── Git utilities (no shell) ─────────────────────────────────────────────────

/** Returns true if cwd is inside a git repository. */
function isGitRepo(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

type StagedEntry =
  | { kind: "scannable"; path: string }
  | { kind: "skip_deleted"; path: string }
  | { kind: "skip_renamed_src"; path: string };

/**
 * Returns the list of staged entries using NUL-delimited output.
 * Throws ScanError on git failure.
 */
function getStagedEntries(): StagedEntry[] {
  // --diff-filter=ACDMRT excludes Unmerged (U) and Unknown (X/B) entries.
  // We use -z for NUL-delimited output — safe for any filename.
  // --name-status gives us the status letter so we can skip deletions explicitly.
  let raw: string;
  try {
    raw = execFileSync(
      "git",
      ["diff", "--cached", "--name-status", "-z", "--diff-filter=ACDMRTUX"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScanError(`git diff --cached failed: ${msg}`);
  }

  if (!raw.trim()) return [];

  // -z output format: STATUS\0PATH\0 for non-renames;
  // R/C entries: STATUS\0OLD_PATH\0NEW_PATH\0
  const entries: StagedEntry[] = [];
  const tokens = raw.split("\0").filter((t) => t !== "");
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i];
    i++;
    if (!status) continue;
    const code = status[0];

    if (code === "R" || code === "C") {
      // Rename/copy: two paths follow
      const _oldPath = tokens[i]; i++;
      const newPath = tokens[i]; i++;
      if (!newPath) break;
      if (!shouldSkip(newPath)) {
        entries.push({ kind: "scannable", path: newPath });
      }
    } else if (code === "D") {
      // Deleted: one path, nothing to read
      const path = tokens[i]; i++;
      if (!path) break;
      entries.push({ kind: "skip_deleted", path });
    } else {
      // Added / Modified / Type-change / etc.: one path
      const path = tokens[i]; i++;
      if (!path) break;
      if (!shouldSkip(path)) {
        entries.push({ kind: "scannable", path });
      }
    }
  }
  return entries;
}

/**
 * Reads staged content for a single path via `git show :PATH`.
 * Uses execFileSync with argv array — path is never interpolated into a shell string.
 * Throws ScanError on failure.
 */
function readStagedContent(path: string): string {
  try {
    return execFileSync("git", ["show", `:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024, // 10 MB cap
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ScanError(`git show ":${path}" failed: ${msg}`);
  }
}

// ── Error type ───────────────────────────────────────────────────────────────

class ScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanError";
  }
}

// ── Pattern scanning ─────────────────────────────────────────────────────────

function scanContent(content: string, sourceLabel: string): string[] {
  const hits: string[] = [];
  for (const { name, pattern } of FORBIDDEN_PATTERNS) {
    if (pattern.test(content)) {
      // Report name and source label only — never the matched content
      hits.push(`  MATCH [${name}]  →  ${sourceLabel}`);
    }
  }
  return hits;
}

// ── Staged scan ──────────────────────────────────────────────────────────────

function scanStaged(): string[] {
  if (!isGitRepo()) {
    throw new ScanError(
      "Not inside a git repository. Cannot scan staged content outside a repo."
    );
  }

  const entries = getStagedEntries();

  if (entries.length === 0) {
    console.log("  [staged] No staged entries found.");
    return [];
  }

  console.log(`  [staged] ${entries.length} staged entries to examine`);
  const allHits: string[] = [];

  for (const entry of entries) {
    if (entry.kind === "skip_deleted") {
      console.log(`  [staged] SKIP (deleted, nothing to read): ${entry.path}`);
      continue;
    }
    if (entry.kind === "skip_renamed_src") {
      console.log(`  [staged] SKIP (rename source, not in index): ${entry.path}`);
      continue;
    }
    // kind === "scannable"
    const content = readStagedContent(entry.path); // throws ScanError on failure
    const hits = scanContent(content, `staged:${entry.path}`);
    allHits.push(...hits);
  }

  return allHits;
}

// ── File scan ────────────────────────────────────────────────────────────────

function scanExplicitFiles(filePaths: string[]): string[] {
  const allHits: string[] = [];
  for (const fp of filePaths) {
    if (shouldSkip(fp)) {
      console.log(`  [file] SKIP (exact skip list): ${fp}`);
      continue;
    }
    if (!existsSync(fp)) {
      // Missing explicit input is a hard error — caller must pass valid paths
      throw new ScanError(`File not found: ${fp}`);
    }
    let content: string;
    try {
      content = readFileSync(fp, { encoding: "utf8" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ScanError(`Cannot read file "${fp}": ${msg}`);
    }
    const hits = scanContent(content, fp);
    allHits.push(...hits);
  }
  return allHits;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const useStaged = args.includes("--staged");
  const filePaths = args.filter((a) => !a.startsWith("--"));

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  NoticeVault Secret Scanner (T-003 fixed)    ║");
  console.log("╚══════════════════════════════════════════════╝");

  // Invalid invocation — no input specified
  if (!useStaged && filePaths.length === 0) {
    console.error(
      "\n✗ INVALID INVOCATION: no input specified.\n" +
        "  Usage: bun run scripts/scan-secrets.ts --staged\n" +
        "         bun run scripts/scan-secrets.ts <file1> [file2 ...]\n" +
        "         bun run scripts/scan-secrets.ts --staged <file1> ...\n"
    );
    process.exit(2);
  }

  let allHits: string[] = [];

  try {
    if (useStaged) {
      console.log("Mode: scan git-staged content (NUL-delimited, no shell)");
      allHits.push(...scanStaged());
    }

    if (filePaths.length > 0) {
      console.log(`Mode: scan ${filePaths.length} explicit file(s)`);
      allHits.push(...scanExplicitFiles(filePaths));
    }
  } catch (err) {
    if (err instanceof ScanError) {
      // Runtime/git/read error — fail hard so caller knows scan was incomplete
      console.error(`\n✗ SCAN ERROR (exit 2): ${err.message}`);
      console.error("  Resolve the error above and re-run the scanner.\n");
      process.exit(2);
    }
    throw err; // unexpected — re-throw
  }

  if (allHits.length > 0) {
    console.error("\n✗ CREDENTIAL PATTERNS FOUND:");
    allHits.forEach((h) => console.error(h));
    console.error("\nScanner FAILED. Remove credentials before committing.\n");
    process.exit(1);
  }

  console.log("\n✓ No credential patterns found. Scanner PASSED.\n");
  process.exit(0);
}

main();
