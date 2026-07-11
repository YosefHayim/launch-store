# ADR 0010 — E2E via the built CLI, not MSW

- **Status:** Accepted — direction set in a `/grill-me-code-style-with-docs` session. — 2026-07-02
- **Context:** we wanted end-to-end coverage and weighed **MSW** (Mock Service Worker) to fake HTTP in an
  e2e. But the wire clients are already unit-tested at the exact seam MSW would occupy, and MSW cuts
  against the repo's testing conventions. This ADR records choosing a built-CLI e2e over MSW.

## Context

MSW intercepts outbound HTTP at the network layer. In launch-store that seam is **already covered**:
`src/apple/ascClient.test.ts` and `src/google/playClient.test.ts` stub `fetch`
(`vi.stubGlobal('fetch', fetchMock)`) with hand-written `fakeResponse(...)` helpers, minting real
ES256/RS256 JWTs and asserting request construction + response parsing. Two conventions weigh against
adding MSW on top:

- **Hand fakes over mock libraries** — AGENTS.md → _"hand-written fakes + `vi.fn` over `vi.mock`
  (boundary modules only)."_ MSW is a heavier interception library, a second network-faking style.
- **Lean dependencies** — the config surface debates adding even a _6th runtime dependency_
  ([ADR 0008](./0008-adopt-zod-config-ssot.md)); a new dev dependency for a seam we already test is hard
  to justify.

## Decision

- **No MSW.** The e2e (`src/**/*.e2e.ts`, run by `npm run test:e2e` via `vitest.e2e.config.ts`) drives
  the **compiled** `dist/cli/index.js` as a real subprocess through `core/exec.ts`'s `capture`
  (`shell: false`, explicit argv), asserting exit codes + output on the offline surface
  (`--version` / `--help` / `explain`, and `config schema` / `validate` / `docs`). `capture` resolves on
  exit 0 and rejects on any non-zero exit, so **resolve-vs-reject is the exit-code assertion.**
- **Isolated + non-shipping.** The suite has its own vitest include, builds dist first in `e2e.yml`, and
  is excluded from the published build (`tsconfig.build.json`) and coverage (`vitest.config.ts`) exactly
  like a `*.testkit.ts` — it never runs in the fast default `vitest run`.
- **Network stays with the unit tests.** The fetch-stub client tests keep owning request/response
  coverage; MSW would duplicate that seam with a heavier tool, a new dependency, and a second faking style.

## Consequences

- **+** Zero new dependencies; **one** network-faking style (hand fakes + `fetch` stub) across the repo.
- **+** The e2e proves the **shipped artifact** boots and behaves — the black-box complement to the
  in-process unit tests.
- **−** The e2e needs a built dist; a `beforeAll` guard fails fast if it's missing, and a build precedes
  it locally and in CI.
- **−** Black-box: it asserts observable output/exit, not internal calls — by design (that's the unit
  tests' job).

## Out of scope

- `nock` / `polly` / other HTTP record-replay — rejected for the same reasons as MSW.
- Live end-to-end of the Mac-only build/submit paths (a real archive or store upload) — operator-verified;
  CI can't drive them ([ADR 0009](./0009-reusable-ci-workflows.md) → macOS out of scope).
