# AGENTS.md

Working rules for AI agents and contributors editing **Launch**. This file holds only what you **can't infer** from the code and configs: module ownership, conventions a linter can't catch, and the validation gate every change must pass. Usage lives in [README.md](./README.md); style depth lives in [CODE-STYLE.md](./CODE-STYLE.md).

> Claude Code reads this through [CLAUDE.md](./CLAUDE.md), which imports this file with `@AGENTS.md`.

## Repo Layout - Who Owns What

One TypeScript / Node ESM package. Top-level `src/` ownership:

| Path | Owns |
| --- | --- |
| `src/cli` | Thin Commander wiring: command names, flags, help text, `runCliProgram(...)`. No domain orchestration. |
| `src/core` | Domain programs, Effect services, config/schema, build/release/store/readiness logic, generated docs, and type homes. |
| `src/providers` | Swappable backend implementations for build, storage, credentials, submit, and compute providers. |
| `src/apple` | App Store Connect transport and ASC wire/resource DTOs. API mirror only. |
| `src/google` | Google Play transport and Play wire/resource DTOs. API mirror only. |
| `src/testkit` | Shared test fakes and Effect test layers. |

Current `src/core` layout:

```text
src/core/
├── adopt/          # importing live store state into config
├── agents/         # agent skill scaffolding
├── asc/            # generated/derived ASC schema helpers
├── build/          # pipeline, build flags, fingerprint, logs, diagnostics, remote/eas handoff
├── config/         # config schema/load/scaffold/semantics/project setup
├── credentials/    # accounts, secrets, keychain, signing assets
├── dashboard/      # terminal dashboard state/rendering
├── distribution/   # install manifests, OTA updates, storage-facing distribution helpers
├── docs/           # generated command/config docs
├── doctor/         # doctor context/inspection
├── insights/       # review/vitals aggregation
├── listing/        # generated listing draft/apply logic
├── mcp/            # MCP server/tools
├── migrate/        # EAS/fastlane migration helpers
├── plan/           # config-vs-store planning/drift
├── privacy/        # privacy parsing/reconciliation/nutrition labels
├── readiness/      # store readiness/probes/preflight
├── release/        # release, rollout, TestFlight/public release
├── releaseTrain/   # release-train records/guards/orchestration
├── services/       # Effect service tags + Live/Test layers and runtime adapters
├── snapshot/       # live store snapshot/diff/source capture
├── store/          # store sync, catalog/product/offers/pricing/reviews/reports across stores
├── terminal/       # CLI presentation helpers, glossary, completion, wordmark
└── types/          # exported domain shapes + index.ts barrel
```

Do not create flat `src/core/*.ts` files. Pick the purpose folder that owns the job.

## Conventions A Linter Can't Infer

### Source Of Truth Files

- Style: [CODE-STYLE.md](./CODE-STYLE.md). Edit there first; this file mirrors only the digest.
- Product direction: [PROJECT.md](./PROJECT.md).
- Architecture orientation: [CONTEXT.md](./CONTEXT.md).
- Domain language: [LANGUAGE.md](./LANGUAGE.md) and runtime teaching text in `src/core/terminal/glossary.ts`.
- Config schema: Effect Schema in `src/core/config/`; zod is migration debt. ADR 0008 is superseded.

### Imports Follow Ownership

```text
src/cli       -> src/core only
src/providers -> src/core/types + src/core/services only, plus vendor SDKs
src/core      -> src/apple and src/google through service adapters only
src/apple     -> src/core/types only, never src/core logic
src/google    -> src/core/types only, never src/core logic
```

### Types And Barrels

`index.ts` is the wildcard barrel. A file named `types.ts` contains actual declarations, not wildcard exports. Exported domain shapes live in `src/core/types/*.ts` and are re-exported from `src/core/types/index.ts`. App Store Connect wire shapes live in `src/apple/ascResources.ts`; Google Play wire shapes currently live in `src/google/playClient.ts` and `src/google/playReporting.ts` until the API mirror split gets its own resources module.

### Providers

Adding a backend means implementing one of the five provider roles as Effect-returning methods and registering it through the ProviderRegistry live layer. Do not edit the pipeline to add a backend. Heavy SDKs stay lazy inside live layers or optional dependency helpers.

### Secrets

Key material never touches the repo or `~/.launch`. `.p8`, `.p12`, private keys, service-account JSON, and passwords live in the OS keychain/secret store or environment. Do not log, write, or commit secrets.

### Rules Digest

<!-- rules digest — full guide in CODE-STYLE.md; edit there -->

The full style guide is [CODE-STYLE.md](./CODE-STYLE.md); `deslop` enforces it per diff. The codebase is migrating to the desired state; write all new code in that state and rewrite touched code on contact.

- **Effect everywhere in production.** Exported behavior returns `Effect`; pure logic -> `Effect.sync`, I/O -> `Effect.gen`.
- **Typed errors only.** `Data.TaggedError`; catch by tag. No raw production `throw new Error`.
- **Services, not classes.** `Context.Tag` + `Layer`; live implementations in `*Live`, tests provide `*Test` layers.
- **Prompting and I/O behind services.** No direct `@clack/prompts`, `fetch`, `fs`, `spawn`, `console.*`, or `process.env` outside live layers/entrypoints/tests/scripts.
- **CLI is thin.** Commander files parse names/flags and call a core Effect program; both interactive and non-interactive paths share that program.
- **Non-TTY never hangs.** Prompts require TTY or explicit flags/`--yes`; `--json` emits machine-clean output.
- **Effect Schema is config SSOT.** zod is temporary migration debt.
- **Purpose-grouped core.** New code goes under `src/core/<job>/`; no new flat-core files.
- **`index.ts` barrels only.** Wildcard exports live in `index.ts`; `types.ts` means real type declarations.
- **Prose naming.** No single-letter params or ritual abbreviations like `ctx`, `cfg`, `res`, `opts`.
- **Complete TSDoc on functions.** Module-scope functions, exported function values, and service/provider methods need purpose, `@param`, and `@returns`; examples when call shape is not obvious.
- **Boring control flow.** No nested ternaries; use guard clauses for one/two branches and `switch` for 3+ alternatives over one discriminant.
- **Tests are colocated.** Vitest, no snapshots, hand fakes, Effect `*Test` layers, shared testkit in `src/testkit/`.

## Style Is Enforced, Not Re-Explained

Formatting and generic TypeScript rules live in `tsconfig.json`, `biome.json`, and the Husky hook. Launch-specific migration rules live in `CODE-STYLE.md` and `scripts/check-style.mjs`; expand the migrated-slice allowlist as old modules are converted.

## Before You Call A Change Done

```bash
pnpm typecheck && pnpm lint && pnpm lint:style && pnpm docs:check && pnpm test && pnpm build
```

All six must be green for migrated slices. Add or update colocated tests for any new behavior.
(`npm run <script>` still works once dependencies are installed with **pnpm**; do not use `npm install` — this repo is `packageManager: pnpm@10` and only has `pnpm-lock.yaml`.)
