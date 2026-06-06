// Zero-dependency assertion suite. Run with `npm test`.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractExpress } from '../src/adapters/express.mjs';
import { normalizePath, routeKey } from '../src/normalize.mjs';
import { match } from '../src/match.mjs';
import { extractRtkQuery } from '../src/adapters/rtk-query.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✅ ${name}`);
};

console.log('seam tests\n');

test('normalizePath collapses every param syntax', () => {
  assert.equal(normalizePath('bookings/${id}/confirm'), 'bookings/{}/confirm');
  assert.equal(normalizePath('bookings/:id/confirm'), 'bookings/{}/confirm');
  assert.equal(normalizePath('/api/v1/users/{id}', { basePath: '/api/v1' }), 'users/{}');
  assert.equal(normalizePath('confirm?bookingId=${id}'), 'confirm');
});

test('express adapter resolves mounts across files', () => {
  const routes = extractExpress({ repoRoot: path.join(root, 'examples/express-fixture'), roots: ['.'] });
  const got = new Set(routes.map((r) => routeKey(r.method, r.rawPath)));
  const expected = [
    'GET health', 'GET status', 'POST status', 'GET api/v1/ping',
    'GET api/v1/users', 'POST api/v1/users', 'GET api/v1/users/:id', 'DELETE api/v1/users/:id',
  ];
  for (const e of expected) assert.ok(got.has(e), `missing route: ${e}`);
  assert.equal(routes.length, expected.length, 'unexpected extra routes');
  assert.ok(!routes.some((r) => r.unresolvedMount), 'no route should be left unresolved');
});

test('matcher is stack-agnostic: rtk client vs express server', () => {
  const endpoints = extractRtkQuery({ repoRoot: root, roots: ['examples/express-fixture-client'] });
  const routes = extractExpress({ repoRoot: path.join(root, 'examples/express-fixture'), roots: ['.'] });
  const result = match(endpoints, routes, { basePath: '/api/v1' });
  assert.equal(result.totals.matched, 5, 'expected 5 matched');
  assert.equal(result.totals.drift, 2, 'expected 2 drift');
  const driftKeys = result.drift.map((d) => routeKey(d.method, d._np)).sort();
  assert.deepEqual(driftKeys, ['GET stats', 'PUT users/{}']);
});

console.log(`\n${passed} passed`);
