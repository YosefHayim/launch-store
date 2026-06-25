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
`types/*.ts` module, not inline in a feature file; the barrel keeps every
`import … from "../core/types.js"` working unchanged, so don't add declarations to it. `src/core/glossary.ts`
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

## Style is enforced, not documented

`tsconfig.json` (max-strict), `eslint.config.js` (`typescript-eslint` strict + stylistic),
`.prettierrc`, and `.husky/pre-commit` are the only source of truth for formatting and type rules —
no `any`, no needless `as`, JSDoc on exports. Don't re-describe those rules; just run them.

## Before you call a change done

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

All four must be green. The husky pre-commit hook runs lint + format + typecheck, but it can be
bypassed and it **doesn't run the tests** — so run the line above yourself, and add a test
(`*.test.ts` beside the code) for any new logic. Keep changes KISS / YAGNI / DRY: extend the nearest
sibling file rather than inventing a new file, util, or abstraction.
