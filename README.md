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
seam check      # report drift + unverifiable, exit non-zero on drift (CI gate)
seam list       # the full resolved contract map (every endpoint + status)
seam orphans    # backend routes no frontend call reaches
seam check --json        # machine-readable
seam check --no-fail     # report only, always exit 0
seam check --config path/to/seam.config.json
```

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

- **Shipped adapters:** `rtk-query` (client); `nestjs` + `openapi` (server).
- **`openapi` is the universal server adapter:** point it at any OpenAPI 2/3
  doc (file or URL) and it covers *every* backend that emits a spec —
  Express+swagger-jsdoc, NestJS, FastAPI, Spring springdoc, .NET Swashbuckle.
  One adapter, N frameworks.
- **Planned:** client → `react-query`, `axios-fetch`, `angular-http`; server →
  `express` (native, for the no-spec MERN/MEAN case), `fastapi`. A new adapter
  is a new ecosystem; the matcher never changes.

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

## Limitations (v0.1)

- Regex extraction, not full AST — robust on conventional code, will miss exotic
  endpoint declarations. v0.2 moves to AST.
- One `@Controller` per file (NestJS convention).
- Path/method existence only; payload shapes land in `--deep` (v0.3).
- Runtime-built urls are surfaced as `unverifiable`, not resolved.

## License

MIT
