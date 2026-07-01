# CODE-STYLE.md

How code is written in **Launch**. Prescriptive (how to write), not descriptive (what exists — that's
[`AGENTS.md`](./AGENTS.md)). The rules digest is mirrored into `AGENTS.md`; **this file is the source —
edit here.** Records the _desired_ end-state; where the code hasn't caught up, the rule is marked
**_migration_** and the before/after shows current → target. `deslop` reads this file to enforce style
per-diff.

## Stack & framework practices

One TypeScript / Node ESM package (a `commander` CLI). Style is **enforced, not documented** —
`tsconfig.json` (max-strict), `biome.json` (`all` preset), and `.husky/pre-commit` own formatting and
type rules (no `any`, no needless `as`, 2-space, single quotes, trailing commas, `.js` ESM imports).
Don't restate them here; run `npm run lint`.

For the recurring how-to tasks, follow the project's own skills instead of duplicating steps here:

- Add a `launch` command → **`add-a-command`**
- Add a build/storage/credentials/submit/compute backend → **`add-a-provider`**
- Add teaching text for a concept/step → **`add-a-glossary-topic`**
- Finish/verify a change (the gate) → **`run-the-gate`**

This file covers only what's specific to Launch on top of those.

## Rules

Load-bearing, project-specific decisions. Each: the rule + a real before/after.

### Files: mirror the API, cap the logic, split by purpose

Three tiers govern file size — **never a flat line limit**:

1. **Exempt — deliberate linear spines and API-mirroring transport.** `core/pipeline.ts` (the single
   build→submit spine) reads top-to-bottom; splitting it hurts more than it helps. The wire clients
   (`apple/ascClient.ts`, `apple/ascResources.ts`, `google/playClient.ts`) mirror the vendor API **1:1** —
   one named method/type per endpoint/resource, each with its own quirk JSDoc. **Do not collapse
   per-endpoint methods into a generic**, even when a cluster is near-identical: 1:1 mapping to Apple/Google
   docs is the navigation win. Keep the _transport_ DRY (the shared private `request` / `requestAll` /
   `createResource` helpers already do this) — repeat only the thin, individually-documented public method.

2. **Logic / orchestration: aim ≤ 200 LOC.** When one grows past, split by _purpose_ first — move type
   declarations to the barrel, extract pure helpers — before splitting by size.

3. **Non-API pure-data repetition → a descriptor table + one generic.** N near-identical blocks differing
   only by constants (a config table, a registry) collapse; this is the _only_ place the "map it" rule
   applies (tier 1 overrides it for the wire clients).

```ts
// before  (src/core/adopt/orchestrator.ts — 265 LOC: 8 exported interfaces inline + 3 logic fns)
export interface TargetPlan { detected: DetectedApp; writes: PlannedWrite[]; errors: AdopterError[]; }
export interface ApplyContext { /* … */ }
export async function planTargets(/* … */) { /* logic */ }

// after  (shapes move to the barrel; the logic file drops to ~180 LOC, logic-only)
// src/core/types/adopt.ts
export interface TargetPlan { detected: DetectedApp; writes: PlannedWrite[]; errors: AdopterError[]; }
// src/core/adopt/orchestrator.ts
import type { ApplyContext, TargetPlan } from '../types.js';
export async function planTargets(/* … */) { /* logic only */ }
```

_Why:_ big is fine when the shape mirrors an official API (easy to follow/navigate); logic that mixes
shapes + branching past ~200 lines is where a purpose-split pays off.

### Types live in one home: `src/core/types/`

**_migration._** Every exported shape lives in `src/core/types/*.ts` (split by concern: `app`, `catalog`,
`storeSurface`, `config`, `credentials`, `artifacts`, `providers`, `remote`, `vitals`, …), re-exported by
the `src/core/types.ts` barrel and imported as `from '../core/types.js'`. The five provider interfaces
(`BuildEngine` / `StorageProvider` / `CredentialsProvider` / `Submitter` / `ComputeHost`) live there too.
No per-feature `types.ts`, and **no exported shape declared inline in a logic file** — inline is only for
non-exported, file-private helper types. Promote a feature-local shape only on a real second consumer.
(The ASC wire types are the one deliberate exception — they mirror Apple's API in `apple/ascResources.ts`,
re-exported via `apple/ascClient.ts`; see tier 1 above.)

```ts
// before  (src/core/plan/types.ts — a per-feature types module)
export interface PlanResult { /* … */ }
// after   (src/core/types/plan.ts, re-exported by the barrel)
export interface PlanResult { /* … */ }   // import { PlanResult } from '../types.js'
```

_Why:_ one place to find any shape; the barrel keeps every `../core/types.js` import stable.

### All output flows through one seam — never raw `console.*`

**_migration._** Domain core (`adopt`, `ascSync`, `plan`, reconcilers) stays **UI-free**: it returns
structured data and never prints. Rendering belongs to the CLI commands and the presentation modules
(`tour`, `progress`, `prompt`, `banner`, `logger`), and it goes through the **output/logger seam**, not
`console.log`. The only sanctioned raw writes are the top-level fatal catch in `cli/index.ts` and the MCP
server (stdout is its protocol — it logs to **stderr** only).

```ts
// before  (src/core/pipeline.ts:614 — a domain module printing raw)
console.log(formatEnvTable(resolved));
// after   (through the Logger already threaded down the pipeline)
log.info(formatEnvTable(resolved));
```

_Why:_ one formatting seam, testable output, and domain modules you can call without side effects.

### Errors: throw a plain `Error` with an actionable message; subclass only at a catch-and-branch boundary

Throw — don't return `{ ok, error }` (reserved for the rare hot path). Default to
`throw new Error(msg)` where `msg` states the _fix_. Add a custom `Error` subclass **only** when a caller
must distinguish and handle it (the API/creds boundaries). Expected graded exits return an `exitCode` in
data, applied centrally; the top-level catch in `cli/index.ts` prints `.message` and exits 1.

```ts
// good — actionable, plain Error  (src/providers/storage/local.ts:71)
if (!existsSync(path)) throw new Error(`No stored artifact with id "${id}".`);
// boundary subclass — a caller catches THIS type  (src/apple/ascClient.ts:205)
export class AscRequestError extends Error { /* status, detail — callers branch on it */ }
```

_Why:_ a CLI's job on failure is a clear message + the right exit code; typed errors only where control
flow needs them.

### Config is a zod schema; types are inferred from it

**_migration — see [ADR 0008](./docs/adr/0008-adopt-zod-config-ssot.md)._** The user's `launch.config.ts`
surface is defined once as a **zod v4** schema; the TS type is `z.infer`'d from it; validation at the
boundary is `.parse()` (structural) plus the existing `configSemantics` cross-field checks. The shipped
`schema/launch.config.schema.json` (editor autocomplete) is generated **from** zod. zod is the SSOT for
_config only_ — every other domain shape stays a hand-written `interface` in the barrel.

```ts
// before  (hand-written interface + hand-rolled validator)
// src/core/types/config.ts
export interface LaunchConfig { app: string; submit: string | SubmitByPlatform; /* … */ }
// src/core/configSchema.ts
export function validateConfig(value: unknown): SchemaViolation[] { /* hand-rolled */ }

// after   (zod schema is the SSOT; type inferred; parse at the edge)
// src/core/types/config.ts
export const LaunchConfigSchema = z.object({ app: z.string(), submit: SubmitSchema, /* … */ });
export type LaunchConfig = z.infer<typeof LaunchConfigSchema>;
// loader
const config = LaunchConfigSchema.parse(loaded);   // structural; then configSemantics(config)
```

_Why:_ one source for the config's type, its validation, and its JSON schema — no hand-kept drift between
the three. Prefer `zod/mini` where tree-shaking matters, to blunt the install-size cost this trades for.

### `interface` for shapes, `type` for the rest; constants at the top

`interface` for object shapes — the official TS heuristic ("use `interface` until you need features from
`type`"), and it matches the provider-interface model. Reach for `type` for unions, tuples, function
types, and mapped/conditional/utility types. **Module constants (especially reused ones) go at the top of
the file, after imports and before any function** — one home for a value that's referenced more than once.

```ts
// good  (src/apple/ascClient.ts:114–118 — constants at top, after imports, before the class)
const API_ORIGIN = 'https://api.appstoreconnect.apple.com';
const TOKEN_TTL_SECONDS = 19 * 60;
```

_Why:_ predictable shapes and a single, greppable home for every tunable.

### Child processes only through `core/exec.ts`

`run` streams (builds, fastlane), `runQuiet` tees to a log + per-line callback, `capture` collects stdout.
All use `shell: false` + an explicit arg array — never a shell string, never `spawn`/`exec` directly. The
one exception is `updateCheck.ts` re-spawning the CLI itself.

```ts
import { run, capture } from '../../core/exec.js';
await run('xcodebuild', ['-scheme', scheme, 'archive']);        // arg array
// ✗ run(`xcodebuild -scheme ${scheme}`)                        // no shell strings, ever
```

_Why:_ closes the shell-injection class of bug at one seam. Exemplar: `src/core/exec.ts`.

### Lazy-load heavy/optional SDKs through `requireOptional`

AWS SDK, native keyring, `eas-cli` are `optionalDependencies`, imported only on the remote / non-Mac
paths. Load them via `core/optionalDep.ts` so a _missing_ package is an actionable "install this" message,
and a local-only install stays lean. Providers that pull heavy SDKs register the import inside their own
methods (see `providers/index.ts`), so a local run never loads them. Exemplar: the `requireOptional`
block in [`AGENTS.md`](./AGENTS.md).

### A backend = a named provider object + one registration

Implement one of the five interfaces as `export const <name><Role>: Role = { name: '<id>', … }` in
`src/providers/<role>/<name>.ts`, then register it in `src/providers/index.ts`. **Never touch
`pipeline.ts`** — it resolves the backend by the `name` in `launch.config.ts`. Exemplars:
`src/providers/storage/local.ts`, `src/providers/index.ts`.

### Comments explain WHY, cross-linked with `{@link}`

Every module opens with a file-level doc stating its _purpose and the non-obvious tradeoff_; every export
carries JSDoc; `{@link}` stitches related modules together. A comment never restates the signature or
narrates WHAT the next line does.

```ts
// before  (narrates WHAT — noise)
// copy the file to the destination
copyFileSync(artifact.path, dest);
// after   (states WHY — the design decision)  cf. src/providers/storage/local.ts
/** A factory (not a singleton) because the base directory is per-project — mirrors the future s3 provider. */
```

_Why:_ Launch is a teaching tool (`--explain`, the glossary); the prose is a feature, not overhead.
Exemplars: `src/core/exec.ts`, `src/providers/storage/local.ts`, `src/core/adopt/orchestrator.ts`.

### Tests: co-located, hand-written fakes, shared fixtures in one testkit

Tests live beside the code (`foo.ts` + `foo.test.ts`), `describe`/`it`, explicit `toBe`/`toEqual`/`toThrow`
— **no snapshots**. Prefer hand-written in-memory fakes + `vi.fn`; reserve `vi.mock` for true I/O boundary
modules (`exec`, `keychain`, `child_process`, `fs`, `paths`). **_migration:_** shared fakes/fixtures live
in one central testkit root (`src/testkit/`), file-named `*.testkit.ts` (already build-excluded by
`tsconfig.build.json`), imported across tests — not re-hand-rolled per file.

```ts
// before  (a fake ASC catalog API rebuilt inline in 7 test files)
const asc: AdoptCatalogApi = { getAppId: vi.fn().mockResolvedValue('123'), /* … */ };
// after   (one home, imported)
import { fakeAscCatalogApi } from '../../testkit/ascCatalogApi.testkit.js';
const asc = fakeAscCatalogApi({ getAppId: '123' });
```

_Why:_ the fake ASC client and the temp-dir dance are written once; tests read as behavior, not setup.

## Recipes

Prefer the skills — they own the exact steps and the doc regeneration.

- **Add a `launch` command** → `add-a-command`. Thin `src/cli/commands/<name>.ts` exporting
  `register<Name>Command(program: Command): void`; wire in `src/cli/program.ts`; parse args → call `core`
  → render through the output seam; regenerate docs.
- **Add a provider (backend)** → `add-a-provider`. Named object implementing one interface + one line in
  `providers/index.ts`; lazy-load heavy SDKs; never touch `pipeline.ts`.
- **Add a domain feature** (a reconcile/plan/adopt surface) → a folder `src/core/<feature>/` with the house
  triplet: `orchestrator.ts` (UI-free, returns data) + `registry.ts` (sub-parts) + shapes in the
  `core/types/` barrel; co-located `*.test.ts`; shared fakes in `src/testkit/`.
- **Add a domain term / teaching text** → `add-a-glossary-topic`. `core/glossary.ts` only (feeds
  `launch explain` + `--explain`); mirror the term in `CONTEXT.md`.
- **Finish a change** → `run-the-gate`: `npm run typecheck && npm run lint && npm run test && npm run build`.

## Exemplars

Write new code like these:

- `src/core/exec.ts` — the child-process seam; three focused wrappers, `shell:false`, why-docs.
- `src/providers/storage/local.ts` — provider shape: factory + registered const, actionable throws, `{@link}`.
- `src/providers/index.ts` — the one registration seam.
- `src/core/adopt/orchestrator.ts` — UI-free domain: detect → plan (read-only) → apply, per-item error isolation.
- `src/apple/ascClient.ts` / `src/apple/ascResources.ts` — the API-mirroring 1:1 transport + wire types.

## Never

- **Raw `console.*` for output** — route through the logger/output seam (except `cli/index.ts`'s fatal catch and the MCP stderr stream).
- **`spawn`/`exec`/`execSync` or a shell string** — every child process goes through `core/exec.ts`.
- **Touch `core/pipeline.ts` to add a backend** — implement an interface + register it in `providers/index.ts`.
- **An exported shape inline in a logic file, or a per-feature `types.ts`** — shapes live in the `core/types/` barrel.
- **Collapse the wire-client per-endpoint methods** — `ascClient`/`ascResources`/`playClient` mirror the vendor API 1:1.
- **A non-null `!` assertion** — narrow with a real check or throw. _(Biome `noNonNullAssertion`.)_
- **`await` inside a loop** — use `Promise.all`; deliberate sequential order (e.g. `adopt` running adopters in registry order) needs a one-line `// why`. _(Biome `noAwaitInLoops`.)_
- **`export default`** — named exports only.
- **Eagerly import a heavy/optional SDK** — lazy-load via `requireOptional`.
- **Log, write, or commit secrets** — `.p8`/`.p12`/keys live in the OS keychain; `~/.launch` holds non-secret paths/ids only.
- **Logic in `src/index.ts`** — re-exports only (the package `exports` entry).
- **Duplicate glossary/teaching strings** — `core/glossary.ts` is the single source.
- **A comment that restates the signature or narrates WHAT** — comments explain WHY / the tradeoff.
- **Snapshot tests, or `vi.mock` where a hand-written fake + `vi.fn` fits** — `vi.mock` is for true I/O boundary modules only.
- **A reused constant declared mid-file** — module constants go at the top, after imports, before functions.
