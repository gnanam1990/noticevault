import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { finalFileRecords, scanStagedFiles } from './staging-integrity.mjs';

test('manifest binds final transformed bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'nv-final-'));
  try {
    writeFileSync(join(root, 'bun.lock'), 'transformed');
    const [file] = finalFileRecords(root, [{ path: 'bun.lock' }]);
    assert.equal(file.bytes, 11);
    assert.equal(file.sha256, createHash('sha256').update('transformed').digest('hex'));
  } finally { rmSync(root, { recursive: true }); }
});

test('symlinks and directories cannot become regular source records', () => {
  const root = mkdtempSync(join(tmpdir(), 'nv-final-'));
  try {
    writeFileSync(join(root, 'target'), 'public fixture');
    symlinkSync(join(root, 'target'), join(root, 'link'));
    mkdirSync(join(root, 'directory'));
    for (const path of ['link', 'directory']) assert.throws(() => finalFileRecords(root, [{ path }]), /NOT_REGULAR/);
  } finally { rmSync(root, { recursive: true }); }
});

test('all staged findings block, including the old regression-fixture path', () => {
  const root = mkdtempSync(join(tmpdir(), 'nv-scan-'));
  try {
    mkdirSync(join(root, 'scripts/ops'), { recursive: true });
    const paths = ['ordinary.mjs', 'scripts/ops/stage-scan.test.mjs'];
    // Inert deterministic grammar fixture; never a service-issued credential.
    const value = 'sk_live_' + 'TESTONLY'.repeat(4);
    for (const path of paths) writeFileSync(join(root, path), '\n'.repeat(64) + value);
    assert.deepEqual(scanStagedFiles(root, paths.map(path => ({ path }))), paths.map(path => ({
      path, category: 'sk_live_ credential', line: 65,
    })));
    for (const path of paths) writeFileSync(join(root, path), 'ordinary public text');
    assert.deepEqual(scanStagedFiles(root, paths.map(path => ({ path }))), []);
  } finally { rmSync(root, { recursive: true }); }
});

test('unsupported binary files do not receive a clean scan result', () => {
  const root = mkdtempSync(join(tmpdir(), 'nv-scan-'));
  try {
    writeFileSync(join(root, 'file'), Buffer.from([0xff, 0xfe]));
    assert.throws(() => scanStagedFiles(root, [{ path: 'file' }]));
  } finally { rmSync(root, { recursive: true }); }
});
