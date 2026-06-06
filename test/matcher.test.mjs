import { test } from 'node:test';
import assert from 'node:assert/strict';

import { match } from '../src/match.mjs';
import { routeKey } from '../src/normalize.mjs';
import { clientEp, serverRoute } from './helpers.mjs';

test('matched: FE call resolving to an existing route', () => {
  const r = match([clientEp('GET', 'users')], [serverRoute('GET', 'users')], {});
  assert.equal(r.totals.matched, 1);
  assert.equal(r.totals.drift, 0);
});

test('drift: FE call with no backend route', () => {
  const r = match([clientEp('GET', 'widgets')], [serverRoute('GET', 'users')], {});
  assert.equal(r.totals.drift, 1);
  assert.equal(r.drift[0].hint, 'no matching backend route');
});

test('drift hint: method mismatch on an existing path', () => {
  const r = match([clientEp('POST', 'users')], [serverRoute('GET', 'users')], {});
  assert.equal(r.totals.drift, 1);
  assert.match(r.drift[0].hint, /as GET, not POST/);
});

test('drift hint: "did you mean" for a near path on the same segment', () => {
  const r = match([clientEp('GET', 'users/profil')], [serverRoute('GET', 'users/profile')], {});
  assert.equal(r.totals.drift, 1);
  assert.match(r.drift[0].hint, /did you mean "users\/profile"/);
});

test('unverifiable: endpoint flagged resolvable:false', () => {
  const r = match([clientEp('GET', null, false)], [], {});
  assert.equal(r.totals.unverifiable, 1);
  assert.equal(r.totals.drift, 0);
});

test('unverifiable: residual dynamic marker after normalize is not drift', () => {
  // A nested-template artifact like `blog/${q ? ...` keeps a `$` after normalize.
  const r = match([clientEp('GET', 'blog/${q')], [], {});
  assert.equal(r.totals.unverifiable, 1);
  assert.equal(r.totals.drift, 0);
});

test('dead: backend route no resolvable FE call reaches', () => {
  const r = match([clientEp('GET', 'users')], [serverRoute('GET', 'users'), serverRoute('GET', 'health')], {});
  assert.equal(r.totals.matched, 1);
  assert.equal(r.totals.dead, 1);
  assert.equal(r.dead[0]._np, 'health');
});

test('ignore: regex on normalized path skips matched + drift', () => {
  const r = match([clientEp('GET', 'internal/secret')], [], { ignore: ['^internal/'] });
  assert.equal(r.totals.drift, 0);
  assert.equal(r.totals.unverifiable, 0);
});

test('ALL/ANY server route matches any verb', () => {
  const r = match([clientEp('POST', 'webhook')], [serverRoute('ALL', 'webhook')], {});
  assert.equal(r.totals.matched, 1);
  assert.equal(r.totals.drift, 0);
});

test('basePath stripped on both sides before matching', () => {
  const r = match([clientEp('GET', 'users')], [serverRoute('GET', 'api/v1/users')], { basePath: '/api/v1' });
  assert.equal(r.totals.matched, 1);
});

test('param-position match: ${id} ↔ :id ↔ {id}', () => {
  const r = match([clientEp('DELETE', 'users/${id}')], [serverRoute('DELETE', 'users/:id')], {});
  assert.equal(r.totals.matched, 1);
  assert.deepEqual(
    [...new Set(r.matched.map((m) => routeKey(m.method, m._np)))],
    ['DELETE users/{}'],
  );
});
