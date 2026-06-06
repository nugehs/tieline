import { normalizePath, routeKey } from './normalize.mjs';

/**
 * Join client endpoints against server routes on (method, normalized path).
 *
 * Buckets:
 *   matched       FE call resolves to an existing BE route          ✅
 *   drift         FE call resolves but BE has no such route         ❌  (the money finding)
 *   unverifiable  FE url could not be resolved to a literal         ⚠️
 *   dead          BE route no resolvable FE call reaches            🟡  (informational)
 */
export function match(endpoints, routes, { basePath = '', ignore = [] } = {}) {
  const ignoreRe = ignore.map((p) => new RegExp(p));
  const isIgnored = (np) => ignoreRe.some((re) => re.test(np));

  // Index BE routes by exact key, and by path (any method) for smarter hints.
  const byKey = new Map();
  const byPath = new Map();
  for (const r of routes) {
    const np = normalizePath(r.rawPath, { basePath });
    r._np = np;
    const key = routeKey(r.method, np);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
    if (!byPath.has(np)) byPath.set(np, []);
    byPath.get(np).push(r);
  }

  const matched = [];
  const drift = [];
  const unverifiable = [];
  const usedKeys = new Set();

  for (const ep of endpoints) {
    if (!ep.resolvable) {
      unverifiable.push(ep);
      continue;
    }
    const np = normalizePath(ep.rawPath, { basePath });
    ep._np = np;

    // Residual `$` or backtick means the url was built conditionally (e.g. a
    // nested template literal) and could not be fully resolved — report as
    // unverifiable, never as drift. `{}` param placeholders are fine.
    if (np == null || /[$`]/.test(np)) {
      unverifiable.push({ ...ep, resolvable: false });
      continue;
    }
    if (isIgnored(np)) continue;

    const key = routeKey(ep.method, np);
    if (byKey.has(key)) {
      matched.push(ep);
      usedKeys.add(key);
      continue;
    }
    drift.push({ ...ep, _np: np, hint: hintFor(ep.method, np, byPath) });
  }

  const dead = routes.filter((r) => !usedKeys.has(routeKey(r.method, r._np)));

  return { matched, drift, unverifiable, dead, totals: counts({ matched, drift, unverifiable, dead }) };
}

// Suggest the likely intended route for a drift finding.
function hintFor(method, np, byPath) {
  const sameP = byPath.get(np);
  if (sameP) {
    const verbs = [...new Set(sameP.map((r) => r.method))].join(', ');
    return `path exists but as ${verbs}, not ${method}`;
  }
  // Nearest path sharing the first segment.
  const seg = np.split('/')[0];
  const near = [...byPath.keys()].filter((p) => p.split('/')[0] === seg);
  if (near.length) {
    const best = near.sort((a, b) => lev(np, a) - lev(np, b))[0];
    if (lev(np, best) <= Math.max(3, Math.round(best.length * 0.34))) {
      return `did you mean "${best}"?`;
    }
  }
  return 'no matching backend route';
}

function counts(b) {
  return {
    matched: b.matched.length,
    drift: b.drift.length,
    unverifiable: b.unverifiable.length,
    dead: b.dead.length,
  };
}

// Tiny Levenshtein for "did you mean" hints.
function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}
