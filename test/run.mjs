// Zero-dependency assertion suite. Run with `npm test`.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizePath, routeKey } from '../src/normalize.mjs';
import { match } from '../src/match.mjs';
import { extractRtkQuery } from '../src/adapters/rtk-query.mjs';
import { extractExpress } from '../src/adapters/express.mjs';
import { extractFastify } from '../src/adapters/fastify.mjs';
import { extractNext } from '../src/adapters/next.mjs';
import { extractFastapi } from '../src/adapters/fastapi.mjs';
import { extractFlask } from '../src/adapters/flask.mjs';
import { extractSpring } from '../src/adapters/spring.mjs';
import { extractAxiosFetch } from '../src/adapters/axios-fetch.mjs';
import { extractAngularHttp } from '../src/adapters/angular-http.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ex = (rel) => path.join(root, 'examples', rel);
const keys = (arr) => new Set(arr.map((r) => routeKey(r.method, normalizePath(r.rawPath))));

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`  ✅ ${name}`);
};
const hasAll = (arr, expected) => {
  const got = keys(arr);
  for (const e of expected) assert.ok(got.has(e), `missing: ${e} (got ${[...got].join(', ')})`);
  assert.equal(got.size, expected.length, `unexpected extra routes: ${[...got].join(', ')}`);
};

console.log('seam tests\n');

test('normalizePath collapses every param syntax', () => {
  assert.equal(normalizePath('bookings/${id}/confirm'), 'bookings/{}/confirm');
  assert.equal(normalizePath('bookings/:id/confirm'), 'bookings/{}/confirm');
  assert.equal(normalizePath('users/<int:id>'), 'users/{}');
  assert.equal(normalizePath('users/[id]'), 'users/{}');
  assert.equal(normalizePath('/api/v1/users/{id}', { basePath: '/api/v1' }), 'users/{}');
  assert.equal(normalizePath('confirm?bookingId=${id}'), 'confirm');
});

// ---- server adapters -----------------------------------------------------

test('express resolves mounts across files', () => {
  hasAll(extractExpress({ repoRoot: ex('express-fixture'), roots: ['.'] }), [
    'GET health', 'GET status', 'POST status', 'GET api/v1/ping',
    'GET api/v1/users', 'POST api/v1/users', 'GET api/v1/users/{}', 'DELETE api/v1/users/{}',
  ]);
});

test('fastify (verb shorthand + route({method,url}))', () => {
  hasAll(extractFastify({ repoRoot: ex('fastify-fixture'), roots: ['.'] }), [
    'GET health', 'POST users', 'GET users/{}', 'DELETE users/{}', 'PUT users/{}', 'PATCH users/{}',
  ]);
});

test('next (app router methods + pages router ALL)', () => {
  hasAll(extractNext({ repoRoot: ex('next-fixture'), roots: ['.'] }), [
    'GET api/users', 'POST api/users', 'GET api/users/{}', 'DELETE api/users/{}', 'ALL api/legacy/{}',
  ]);
});

test('fastapi (APIRouter prefix + include_router)', () => {
  hasAll(extractFastapi({ repoRoot: ex('fastapi-fixture'), roots: ['.'] }), [
    'GET health', 'GET api/users', 'GET api/users/{}', 'POST api/users',
  ]);
});

test('flask (blueprint url_prefix + methods=[])', () => {
  hasAll(extractFlask({ repoRoot: ex('flask-fixture'), roots: ['.'] }), [
    'GET health', 'GET api/users', 'POST api/users', 'DELETE api/users/{}',
  ]);
});

test('spring (@RequestMapping base + @*Mapping)', () => {
  hasAll(extractSpring({ repoRoot: ex('spring-fixture'), roots: ['.'] }), [
    'GET api/users', 'GET api/users/{}', 'POST api/users', 'DELETE api/users/{}',
  ]);
});

// ---- client adapters -----------------------------------------------------

test('axios-fetch (axios.get / axios({}) / fetch)', () => {
  hasAll(extractAxiosFetch({ repoRoot: ex('axios-fixture'), roots: ['.'] }), [
    'GET api/users', 'POST api/users', 'GET api/users/{}', 'DELETE api/users/{}', 'GET api/ping', 'PUT api/users/{}',
  ]);
});

test('angular-http (this.http.get<T>())', () => {
  hasAll(extractAngularHttp({ repoRoot: ex('angular-fixture'), roots: ['.'] }), [
    'GET api/users', 'POST api/users', 'GET api/users/{}', 'DELETE api/users/{}',
  ]);
});

// ---- stack-agnostic matcher (mix any client with any server) -------------

test('matcher: rtk-query client ↔ express server', () => {
  const endpoints = extractRtkQuery({ repoRoot: root, roots: ['examples/express-fixture-client'] });
  const routes = extractExpress({ repoRoot: ex('express-fixture'), roots: ['.'] });
  const result = match(endpoints, routes, { basePath: '/api/v1' });
  assert.equal(result.totals.matched, 5);
  assert.equal(result.totals.drift, 2);
  assert.deepEqual(result.drift.map((d) => routeKey(d.method, d._np)).sort(), ['GET stats', 'PUT users/{}']);
});

test('matcher: angular-http client ↔ spring server (clean MEAN/enterprise)', () => {
  const endpoints = extractAngularHttp({ repoRoot: ex('angular-fixture'), roots: ['.'] });
  const routes = extractSpring({ repoRoot: ex('spring-fixture'), roots: ['.'] });
  const result = match(endpoints, routes, { basePath: '' });
  assert.equal(result.totals.matched, 4);
  assert.equal(result.totals.drift, 0);
});

test('matcher: axios-fetch client ↔ fastapi server (drift detected)', () => {
  const endpoints = extractAxiosFetch({ repoRoot: ex('axios-fixture'), roots: ['.'] });
  const routes = extractFastapi({ repoRoot: ex('fastapi-fixture'), roots: ['.'] });
  const result = match(endpoints, routes, { basePath: '' });
  assert.equal(result.totals.matched, 3, 'GET+POST users, GET users/{}');
  assert.equal(result.totals.drift, 3, 'DELETE, PUT, ping have no backend route');
});

console.log(`\n${passed} passed`);
