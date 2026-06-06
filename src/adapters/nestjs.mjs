import fs from 'node:fs';
import path from 'node:path';

import { walk, lineAt } from '../util/walk.mjs';
import { joinPath } from '../normalize.mjs';

/**
 * Server adapter for NestJS controllers.
 *
 * For each `*.controller.ts` it reads the `@Controller('prefix')` and every
 * route decorator (`@Get`, `@Post`, `@Patch`, `@Put`, `@Delete`), composing the
 * prefix-relative path. The runtime global prefix (api/v1) is NOT prepended —
 * decorators are prefix-relative and so are RTK call sites, so they match
 * directly.
 */
export function extractNestjs({ repoRoot, roots }) {
  const files = roots.flatMap((r) =>
    walk(
      path.join(repoRoot, r),
      (name) => name.endsWith('.controller.ts') && !name.endsWith('.spec.ts'),
    ),
  );

  const routes = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    routes.push(...parseFile(text, file));
  }
  return routes;
}

const VERB_RE = /@(Get|Post|Put|Patch|Delete)\s*\(\s*(?:(['"`])([\s\S]*?)\2)?\s*(?:,|\))/g;

function parseFile(text, file) {
  // First @Controller in the file wins (one controller per file is the Nest convention).
  const ctrl = text.match(/@Controller\s*\(\s*(?:(['"`])([\s\S]*?)\1)?\s*(?:,|\))/);
  const prefix = ctrl && ctrl[2] != null ? ctrl[2] : '';

  const out = [];
  let m;
  VERB_RE.lastIndex = 0;
  while ((m = VERB_RE.exec(text))) {
    const method = m[1].toUpperCase();
    const sub = m[3] != null ? m[3] : '';
    out.push({
      side: 'server',
      method,
      rawPath: joinPath(prefix, sub),
      controller: prefix,
      file,
      line: lineAt(text, m.index),
    });
  }
  return out;
}
