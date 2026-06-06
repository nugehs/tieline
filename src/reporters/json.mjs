const slim = (e) => ({
  name: e.name,
  method: e.method,
  path: e._np ? '/' + e._np : null,
  resolvable: e.resolvable !== false,
  hint: e.hint,
  file: e.file,
  line: e.line,
});

export function reportJson(result) {
  const { matched, drift, unverifiable, dead, totals } = result;
  console.log(
    JSON.stringify(
      {
        totals,
        drift: drift.map(slim),
        unverifiable: unverifiable.map(slim),
        matched: matched.map(slim),
        dead: dead.map((r) => ({ method: r.method, path: '/' + r._np, file: r.file, line: r.line })),
      },
      null,
      2,
    ),
  );
}
