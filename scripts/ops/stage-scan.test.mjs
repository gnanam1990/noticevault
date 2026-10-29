#!/usr/bin/env node
/**
 * Offline grammar/boundary tests for the production secret scanner.
 * TESTONLY bodies are deterministic test data, never service-issued tokens.
 * Invalid all-zero/all-f scalars cannot be secp256k1 private keys. Database
 * fixtures use the reserved .invalid domain. No network or credential lookup
 * occurs. Values exist only in memory, are never logged, and are not exempted
 * from the scanner. Do not replace these generators with captured credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scanLine } from './scan-logic.mjs';

/** @param {number} length */
const testBody = length => 'TESTONLY'.repeat(Math.ceil(length / 8)).slice(0, length);
/** @param {string} line */
const categories = line => scanLine(line).map(hit => hit.category);
/** @param {string} name @param {string} value */
const assignment = (name, value) => `${name}=${value}`;

for (const prefix of ['sk_live_', 'sk_test_']) {
  for (const length of [15, 16, 17, 40]) {
    test(`${prefix} threshold ${length}`, () => {
      assert.equal(categories(prefix + testBody(length)).includes(prefix + ' credential'), length >= 16);
    });
  }
}

for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_']) {
  for (const length of [19, 20, 21, 48]) {
    test(`${prefix} standalone and quoted threshold ${length}`, () => {
      const value = prefix + testBody(length);
      for (const line of [value, JSON.stringify(value)]) {
        assert.equal(categories(line).includes('GitHub token literal'), length >= 20);
      }
    });
  }
}

for (const name of ['CF_API_TOKEN', 'CLOUDFLARE_API_TOKEN']) {
  for (const separator of ['=', ':', ' = ']) {
    test(`${name} assignment boundary ${JSON.stringify(separator)}`, () => {
      for (const length of [19, 20, 21]) {
        assert.equal(categories(name + separator + testBody(length)).includes('Cloudflare API token env assignment'), length >= 20);
      }
    });
  }
}

test('GitHub assignment retains both assignment and standalone detection', () => {
  for (const prefix of ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_']) {
    assert.deepEqual(categories(assignment('GITHUB_TOKEN', prefix + testBody(24))),
      ['GitHub token literal', 'GitHub token env assignment']);
  }
});

for (const name of ['JWT_SECRET', 'API_JWT_SECRET', 'SESSION_SECRET']) {
  test(`${name} threshold and placeholders`, () => {
    for (const length of [15, 16, 17]) {
      assert.equal(categories(assignment(name, testBody(length))).includes('JWT/session secret assignment (non-placeholder)'), length >= 16);
    }
    for (const placeholder of ['REPLACE_WITH_A_STRONG_RANDOM_SECRET', '${FROM_VAULT}']) {
      assert.deepEqual(categories(assignment(name, placeholder)), []);
    }
  });
}

test('Bearer minimum length is enforced', () => {
  for (const length of [31, 32, 33]) {
    assert.equal(categories(`Authorization: Bearer ${testBody(length)}`).includes('Bearer token (long)'), length >= 32);
  }
});

test('keyed RPC grammar is detected without contacting a provider', () => {
  const endpoint = new URL('https://arc-mainnet.g.alchemy.com/v2/');
  assert.deepEqual(categories(endpoint.href), []);
  for (const length of [19, 20, 21]) {
    assert.equal(categories(endpoint.href + testBody(length)).includes('Alchemy / keyed HTTPS RPC URL'), length >= 20);
  }
  assert.deepEqual(categories('https://rpc.example.invalid/'), []);
});

test('invalid scalars still exercise private-key assignment grammar', () => {
  for (const name of ['privateKey', 'signerKey', 'PRIVATE_KEY', 'SECRET_KEY', 'SIGNING_KEY']) {
    for (const digit of ['0', 'f']) {
      for (const length of [63, 64, 65]) {
        const scalar = '0x' + digit.repeat(length);
        assert.equal(categories(assignment(name, JSON.stringify(scalar))).includes('Private key in assignment context'), length === 64);
      }
    }
  }
  assert.deepEqual(categories('0x' + '0'.repeat(64)), []);
});

test('database userinfo is detected on a reserved invalid hostname', () => {
  const endpoint = new URL('postgresql://db.invalid/example');
  endpoint.username = 'EXAMPLE_USER';
  endpoint.password = 'NOT_A_PASSWORD';
  assert.deepEqual(categories(endpoint.href), ['DATABASE_URL with non-placeholder credentials']);
  endpoint.username = 'noticevault';
  endpoint.password = 'noticevault_dev';
  assert.deepEqual(categories(endpoint.href), []);
  assert.deepEqual(categories('postgresql://${DB_USER}:${DB_PASS}@db.invalid/example'), []);
});

test('canary-shaped test data receives no production exemption', () => {
  assert.deepEqual(categories('sk_live_' + 'X'.repeat(40)), ['sk_live_ credential']);
  assert.deepEqual(categories('sk_live_' + testBody(24)), ['sk_live_ credential']);
});

test('stored regression source needs no credential or file-path exemption', () => {
  const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  for (const [index, line] of lines.entries()) {
    assert.deepEqual(categories(line), [], `Unexpected stored finding at line ${index + 1}`);
  }
});
