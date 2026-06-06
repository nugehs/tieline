# seam

**Static FE↔BE contract-drift checker. Pact without writing a single contract test.**

`seam` reads the code you already wrote on both sides of an API boundary — the
HTTP calls your frontend makes and the routes your backend exposes — and tells
you where they disagree. No contract tests to author, no broker to run, no
backend to boot. It finishes in under a second and is meant to run in CI as a
gate.

> Delete the LLM and a developer still installs it. `seam` is a deterministic
> tool first; an agent reading its output is a bonus.

## What it finds

```
  seam · contract check

  ❌  38 drift  (FE calls a route the backend does not expose)
     GET    /users/{}
            getUser  ·  redux/apis/user-api.ts:88
            → did you mean "user/{}"?            # singular vs plural — a guaranteed 404
     PUT    /enquiries/{}
            updateEnquiryDetails  ·  redux/apis/enquiry-api.ts:140
            → path exists but as GET, not PUT    # method mismatch

  ⚠️   15 unverifiable  (url built at runtime — cannot resolve statically)

  ✅ 278 matched   ❌ 38 drift   ⚠️  15 unverifiable   🟡 275 unused backend routes
```

Four buckets:

| Bucket             | Meaning                                              |
| ------------------ | ---------------------------------------------------- |
| ✅ **matched**      | FE call resolves to an existing BE route             |
| ❌ **drift**        | FE call resolves but the BE has no such route/method |
| ⚠️ **unverifiable** | FE url is built at runtime — reported, never guessed |
| 🟡 **dead**         | BE route no resolvable FE call reaches (informational)|

`drift` is the money bucket. `unverifiable` is the honesty bucket: a url like
`` `blog/tags/popular${q ? `?limit=${q}` : ''}` `` can't be resolved statically,
so `seam` says so rather than crying wolf.

## Usage

```bash
seam check      # FE↔BE drift: report + exit non-zero on drift (CI gate)
seam list       # the full resolved contract map (every endpoint + status)
seam orphans    # backend routes no frontend call reaches
seam doctor     # code↔spec drift: routes in code but missing from the OpenAPI doc
seam check --json        # machine-readable
seam check --no-fail     # report only, always exit 0
seam check --config path/to/seam.config.json
```

### `seam doctor` — does your code match your published docs?

Diffs routes parsed from source (a native adapter like `nestjs`) against the
routes declared in your OpenAPI spec (`server.spec`, a file or live URL):

```
  seam · doctor   code (nestjs)  ↔  spec (http://localhost:9999/doc-json)

  ❌  36 undocumented  (in code, missing from the published spec)
     GET    /premium-analytics/subscription/features   src/premium-analytics/...:54
     POST   /ai/generate-image                         src/cloudflare-ai/...:42
     ...
  👻  0 phantom  (in the spec, no matching route in code)

  ✅ 517 agree   ❌ 36 undocumented   👻 0 phantom   (553 code routes, 517 spec routes)
```

`undocumented` = working routes invisible to anyone generating an SDK or
partner integration from the spec. `phantom` = the spec promises a route the
code no longer serves (stale docs). On the bashbop backend, `doctor` flagged 5
entire modules (`/ai`, `/theme`, `/premium-analytics`, `/recommendations`,
`/dummy-events`) absent from the published doc — and, in passing, caught a Nest
`@Post([...])` array-path route that an early version of the parser had missed.

## Configuration

`seam.config.json` (searched for upward from cwd):

```jsonc
{
  "client": {
    "adapter": "rtk-query",         // pluggable client adapter
    "repo": "../bashbop-event-web", // resolved relative to this config file
    "roots": ["redux/apis", "src/redux/apis"],
    "basePath": "/api/v1"           // stripped from call sites before matching
  },
  "server": {
    "adapter": "nestjs",            // pluggable server adapter
    "repo": "../bashbop-api",
    "roots": ["src"],
    "globalPrefix": "api/v1"
  },
  "ignore": ["bookings/legacy/.*"], // regexes on the normalized path
  "failOn": ["drift"]               // which buckets make `check` exit non-zero
}
```

## Architecture

The matcher is adapter-agnostic. Each side implements one extractor:

```
ClientAdapter.extract() → Endpoint[] { method, rawPath, resolvable, file, line }
ServerAdapter.extract() → Route[]    { method, rawPath, file, line }
                  │                          │
                  └──────── normalize ───────┘   ${id} | :id | {id} → {}
                              join on (method, path)
                  ❌ drift   🟡 dead   ⚠️ unverifiable   ✅ matched
```

**Shipped adapters** (mix any client with any server — the matcher is the same):

| Client (calls)                          | Server (routes)                                            |
| --------------------------------------- | ---------------------------------------------------------- |
| `rtk-query` — Redux Toolkit Query       | `nestjs` — decorators                                      |
| `axios-fetch` — axios / fetch, React Query/SWR queryFns | `express` — `app.use()` mount graph, cross-file |
| `angular-http` — Angular `HttpClient`   | `fastify` — verb shorthand + `route({})`                   |
|                                         | `next` — file-based (app router + pages API)               |
|                                         | `fastapi` — `APIRouter` prefix + `include_router`          |
|                                         | `flask` — blueprints + `methods=[]`                        |
|                                         | `spring` — `@RequestMapping` + `@*Mapping`                 |
|                                         | `openapi` — **universal**: any OpenAPI 2/3 doc (file/URL)  |

That covers **MERN** (rtk/axios ↔ express), **MEAN** (angular ↔ express),
**MEVN** (axios ↔ express), **Next** full-stack, **Python** (axios/angular ↔
fastapi/flask), and **enterprise** (angular ↔ spring) — plus `openapi` for any
backend that emits a spec (Express+swagger-jsdoc, FastAPI auto, Spring
springdoc, .NET Swashbuckle, …).

Notes:
- **`express`** walks the `app.use()` mount graph across `require`/`import`
  boundaries and nested routers; routers it can't reach are flagged
  `unresolvedMount`, never dropped.
- **`next`** is file-system routing: app-router files export `GET`/`POST`/…;
  pages-router handlers serve any verb (matched as `ALL`).
- **Planned:** `react-query`/`swr` first-class clients, `koa`/`django` servers,
  `--deep` OpenAPI DTO-shape diffing. A new adapter is a new ecosystem; the
  matcher never changes — proven by tests running RTK↔Express, Angular↔Spring,
  and axios↔FastAPI through one unchanged matcher.

### Native vs spec = documentation drift

Running a **native** server adapter (`nestjs`) and the **`openapi`** adapter
against the same backend and diffing the two surfaces a distinct bug class:
routes that exist in code but are **missing from the published spec** (or vice
versa). On the bashbop backend this found 10 working routes
(`premium-analytics/*`, `feed-back/send`, `user/add-user`, `excel/import`)
absent from the live OpenAPI doc — invisible to any SDK or partner generated
from that spec.

## Roadmap

- **v0.1 (this)** — path + method existence drift. Static, zero-dependency, CI-gateable.
- **v0.2** — SARIF output (inline GitHub PR annotations), `seam.config` ignores.
- **v0.3 `--deep`** — emit `openapi.json` from the NestJS side and diff
  request/response **DTO shapes**, not just paths. This is where the expensive
  bugs (a renamed field, a changed enum) get caught.
- **v0.4+** — second client/server adapter to prove the abstraction holds.

## Tests

```bash
npm test    # node --test, zero dependencies
```

52 tests on Node's built-in runner, no test framework to install:

- **normalize** — every param syntax (`${id}`/`:id`/`<int:id>`/`[id]`/`{id}`),
  query stripping, basePath, `joinPath`.
- **matcher** — all four buckets, drift hints (method-mismatch, "did you mean"),
  `ignore`, `ALL`/`ANY` any-verb routes, cross-syntax param matching.
- **adapters** — every server + client adapter against a fixture, plus edge
  cases via throwaway temp repos (Express `app.all` + unmounted router, Next
  route groups + catch-all, Spring `@RequestMapping(method=…)`, Flask default
  GET, rtk-query runtime urls → unverifiable, non-HttpClient `.get()` ignored).
- **openapi** — OpenAPI 3 `servers[].url` prefix, Swagger 2 `basePath`, config
  `stripPrefix`, missing-file error.
- **doctor** — undocumented / phantom / matched, method-mismatch hints, ignore.
- **integration** — three cross-stack matcher proofs (RTK↔Express,
  Angular↔Spring, axios↔FastAPI) and the real `seam` CLI (exit codes, `--json`,
  `--no-fail`, `doctor`, unknown-adapter error).

## Limitations (v0.1)

- Regex extraction, not full AST — robust on conventional code, will miss exotic
  endpoint declarations. v0.2 moves to AST.
- One `@Controller` per file (NestJS convention).
- Path/method existence only; payload shapes land in `--deep` (v0.3).
- Runtime-built urls are surfaced as `unverifiable`, not resolved.

## License

MIT
