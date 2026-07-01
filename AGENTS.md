# AGENTS.md

Working rules for AI agents and contributors editing **Launch**. This file holds only what you
**can't infer** from the code and configs: module ownership, the conventions a linter can't catch,
and the gate every change must pass. It does **not** restate style rules (those live in the tooling)
or usage (that's [`README.md`](./README.md)).

> Claude Code reads this via [`CLAUDE.md`](./CLAUDE.md), which imports it with `@AGENTS.md`.

## Repo layout — who owns what

One TypeScript / Node ESM package. Four areas under `src/`:

| Path            | Owns                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------- |
| `src/cli`       | Thin `commander` wiring — parse args, call into `core`. No domain logic here.             |
| `src/core`      | The domain: types, the build→submit pipeline, the provider registry, exec/paths/glossary. |
| `src/providers` | The swappable backends (build, storage, credentials, submit, compute).                    |
| `src/apple`     | The App Store Connect integration (JWT auth, bundle ids, certs, profiles).                |

The build→submit spine is `core/pipeline.ts`; off-Mac builds branch into `core/remotePipeline.ts`
(remote-host lifecycle) and `core/easPipeline.ts` (Expo handoff) beside it.

## Conventions a linter can't enforce

### Types are the single source of truth

The **types module** defines every domain shape and the provider interfaces: the `src/core/types.ts`
barrel re-exports `src/core/types/*.ts`, split by concern (`app`, `catalog`, `storeSurface`, `config`,
`credentials`, `artifacts`, `providers`, `remote`, `vitals`). Add or change a shape in the matching
`types/*.ts` module — not inline in a feature file, and not in a per-feature `types.ts` (fold those into
the barrel); the barrel keeps every
`import … from "../core/types.js"` working unchanged, so don't add declarations to it. (The **config** surface is the one exception to
hand-written shapes — it's a zod schema with its type inferred; see
[ADR 0008](./docs/adr/0008-adopt-zod-config-ssot.md).) The same
barrel pattern governs the **App Store Connect wire types** — the `*Resource` / `*Query` shapes the
client reads and writes live in `src/apple/ascResources.ts`, and `src/apple/ascClient.ts` re-exports
them with `export *`, so `import … from "../apple/ascClient.js"` keeps resolving every ASC type
unchanged. Add a new ASC shape to `ascResources.ts`; keep `ascClient.ts` to its transport core and the
`AppStoreConnectClient` class. (Older ADRs say "ASC wire types in `ascClient.ts`" — that predates the
split and means the import surface, which is unchanged.) `src/core/glossary.ts`
is the single source for teaching text — it feeds both `launch explain` and the `--explain` step
expansions; never duplicate those strings elsewhere.

### Adding a backend = implement an interface + register it

Pick one of the five provider interfaces — `BuildEngine` / `StorageProvider` /
`CredentialsProvider` / `Submitter` / `ComputeHost` — from `types.ts`, implement it as a named
object, and register it in `src/providers/index.ts`. The pipeline resolves it by the `name` in the
user's `launch.config.ts`, so **you never touch `core/pipeline.ts` to add a backend.**

```ts
// src/providers/storage/s3.ts
import type { BuildArtifact, StorageProvider, StoredArtifact } from "../../core/types.js";

export const s3StorageProvider: StorageProvider = {
  name: "s3", // ← the value users put in launch.config.ts (`storage: "s3"`)
  async put(artifact: BuildArtifact): Promise<StoredArtifact> {
    const { S3Client } = await import("@aws-sdk/client-s3"); // lazy — see below
    /* …upload, then return { id, location } */
  },
  async list() {
    /* … */
  },
  async url(id) {
    /* … */
  },
};
```

```ts
// src/providers/index.ts — registerBuiltins() wires every provider in by name
registerStorageProvider(s3StorageProvider);
```

### Lazy-load heavy SDKs through `requireOptional`

The AWS SDK and the native keyring are `optionalDependencies`, imported only on the remote / non-Mac
paths so a local-only install stays lean. Load them through `core/optionalDep.ts` so a _missing_
package becomes an actionable "install this" message instead of a stack trace:

```ts
import { requireOptional } from "../../core/optionalDep.js";

const { EC2Client } = await requireOptional(
  "AWS EC2 Mac builds", // what needs it
  "npm i @aws-sdk/client-ec2 @aws-sdk/credential-providers", // the exact install hint
  () => import("@aws-sdk/client-ec2"), // the lazy import, as a thunk
);
```

### All child processes go through `core/exec.ts`

`run` streams output (builds, fastlane); `capture` collects stdout for parsing. Both use
`shell: false` with an explicit argument array, which closes the shell-injection class of bug. Never
build a shell string or call `spawn` / `exec` directly.

```ts
import { run, capture } from "../../core/exec.js";

await run("xcodebuild", ["-scheme", scheme, "archive"]); // arg array, never a string
const identities = await capture("security", ["find-identity", "-v", "-p", "codesigning"]);
// ✗ run(`xcodebuild -scheme ${scheme}`) — no shell strings, ever
```

### The config seam stays logic-free

The user's `launch.config.ts` is loaded with jiti; the public API (`defineConfig` + the config
types) is re-exported from `src/index.ts`, which is the package `exports` entry. Keep `src/index.ts`
**re-exports only** — no logic.

### Secrets never touch the repo or `~/.launch`

The `.p8` / `.p12` / private keys live in the OS keychain; `~/.launch` holds non-secret paths and
ids only (e.g. `cloud.json`). Don't log, write, or commit key material, and honor `.gitignore`.

### Rules digest

<!-- rules digest — full guide in CODE-STYLE.md; edit there -->

The full style guide (with before/after from real files) is [`CODE-STYLE.md`](./CODE-STYLE.md); `deslop`
enforces it per-diff. Four rules below are **in-flight migrations** — write new code the new way; existing
code converts opportunistically. Beyond the subsections above:

- **File size is tiered, not capped.** The linear spine (`pipeline.ts`) and the API-mirroring wire clients
  (`ascClient` / `ascResources` / `playClient`) are exempt and mirror the vendor API **1:1** — never
  collapse their per-endpoint methods. Logic/orchestration aims **≤ 200 LOC**; split by _purpose_ (shapes →
  the barrel) before size.
- **One types home** _(migration)_ — every exported shape in `src/core/types/*`, imported as
  `../core/types.js`; no per-feature `types.ts`, no exported shape inline in a logic file.
- **One output seam** _(migration)_ — domain core returns data and never prints; rendering goes through the
  logger/output module, never raw `console.*` (except `cli/index.ts`'s fatal catch and the MCP **stderr**
  stream).
- **Errors: throw a plain `Error` with an actionable message;** subclass only where a caller catches and
  branches; graded exits return an `exitCode` in data.
- **Config is a zod schema** _(migration)_ — type inferred, `.parse` at the boundary, JSON Schema generated
  from it; see [ADR 0008](./docs/adr/0008-adopt-zod-config-ssot.md).
- **`interface` for shapes, `type` for unions/functions;** module constants at the top, after imports.
- **Comments explain WHY,** cross-linked with `{@link}`; a file-level why-doc opens every module.
- **Tests co-located;** hand-written fakes + `vi.fn` over `vi.mock` (boundary modules only); shared fixtures
  in one testkit root _(migration:_ `src/testkit/`, `*.testkit.ts`_)_; no snapshots.
- **Never** a non-null `!` assertion, `await` in a loop (use `Promise.all`; deliberate order gets a
  `// why`), or `export default` (named exports only).

## Style is enforced, not documented

`tsconfig.json` (max-strict), `biome.json` (Biome's linter + formatter, `all` rule preset), and
`.husky/pre-commit` are the only source of truth for formatting and type rules —
no `any`, no needless `as`, JSDoc on exports. Don't re-describe those rules; just run them.

## Before you call a change done

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

All four must be green. The husky pre-commit hook runs lint + format + typecheck, but it can be
bypassed and it **doesn't run the tests** — so run the line above yourself, and add a test
(`*.test.ts` beside the code) for any new logic. Keep changes KISS / YAGNI / DRY: extend the nearest
sibling file rather than inventing a new file, util, or abstraction.
