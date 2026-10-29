import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { scanLine } from './scan-logic.mjs';

/** @param {string} root @param {{path:string}[]} records */
export function finalFileRecords(root, records) {
  return records.map(f => {
    const path = join(root, f.path);
    if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('NOT_REGULAR');
    const bytes = readFileSync(path);
    return { path: f.path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
}

/** Scan every staged UTF-8 file. Findings have no path, line, or fixture exemption.
 * @param {string} root @param {{path:string}[]} records */
export function scanStagedFiles(root, records) {
  /** @type {{path:string,category:string,line:number}[]} */
  const findings = [];
  for (const { path } of records) {
    const bytes = readFileSync(join(root, path));
    // Refuse unsupported binary content instead of silently declaring it clean.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    for (const [index, line] of text.split('\n').entries()) {
      for (const { category } of scanLine(line)) findings.push({ path, category, line: index + 1 });
    }
  }
  return findings;
}
