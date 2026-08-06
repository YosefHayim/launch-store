# AGENTS.md

Working rules for AI agents and contributors editing **Launch**. This file holds only what you **can't infer** from the code and configs: module ownership, conventions a linter can't catch, and the validation gate every change must pass. Usage lives in [README.md](./README.md); style depth lives in [CODE-STYLE.md](./CODE-STYLE.md). Branch and PR workflow lives in [BRANCHING.md](./BRANCHING.md).

> Claude Code reads this through [CLAUDE.md](./CLAUDE.md), which imports this file with `@AGENTS.md`.

## Branching And PRs

- **Do not commit to `main`.** Branch as `feat|fix|refactor|chore|docs/<domain>/<slug>`, open a PR, label `domain:<domain>`, keep the gate green, delete the branch after merge.
- Domains: `foundation`, `config`, `credentials`, `build`, `apple`, `google`, `store`, `release`, `testflight`, `readiness`, `agents`, `cli`, `docs`.
- Full rules, CODEOWNERS path map, and the optional `experiment/layered-history` lab: [BRANCHING.md](./BRANCHING.md).

## Repo Layout - Who Owns What

One TypeScript / Node ESM package. Top-level `src/` ownership:

| Path | Owns |
| --- | --- |
| `src/cli` | Thin Commander wiring: command names, flags, help text, `runCliProgram(...)`. No domain orchestration. |
| `src/core` | Domain programs, Effect services, config/schema, build/release/store/readiness logic, generated docs, and type homes. |
| `src/providers` | Swappable backend implementations for build, storage, credentials, submit, and compute providers. |
| `src/apple` | App Store Connect transport and the generated Apple API mirror. |
| `src/google` | Google Play transport wrappers around Google's official generated clients. |
| `src/testkit` | Shared test fakes and Effect test layers. |

Current `src/core` layout:

```text
src/core/
 adopt/          # importing live store state into config
 agents/         # agent skill scaffolding
 build/          # pipeline, build flags, fingerprint, logs, diagnostics, remote/eas handoff
 config/         # config schema/load/scaffold/semantics/project setup
 credentials/    # accounts, secrets, keychain, signing assets
 dashboard/      # terminal dashboard state/rendering
 distribution/   # install manifests, OTA updates, storage-facing distribution helpers
 docs/           # generated command/config docs
 doctor/         # doctor context/inspection
 insights/       # review/vitals aggregation
 listing/        # listing drafts/apply logic and screenshot asset specifications
 mcp/            # MCP server/tools
 migrate/        # EAS/fastlane migration helpers
 plan/           # config-vs-store planning/drift
 privacy/        # privacy parsing/reconciliation/nutrition labels
 readiness/      # store readiness/probes/preflight
 release/        # release, rollout, TestFlight/public release
 releaseTrain/   # release-train records/guards/orchestration
 services/       # Launch-owned Effect service contracts + Live/Test layers
 snapshot/       # live store snapshot/diff/source capture
 store/          # store sync, catalog/product/offers/pricing/reviews/reports across stores
 terminal/       # CLI presentation helpers, glossary, completion, wordmark
 types/          # exported domain shapes imported from owning modules
```

Do not create flat `src/core/*.ts` files. Pick the purpose folder that owns the job.

## Conventions A Linter Can't Infer

### Source Of Truth Files

- Style: [CODE-STYLE.md](./CODE-STYLE.md). Edit there first; this file mirrors only the digest.
- Product direction: [PROJECT.md](./PROJECT.md).
- Architecture orientation: [CONTEXT.md](./CONTEXT.md).
- Domain language: [LANGUAGE.md](./LANGUAGE.md) and runtime teaching text in `src/core/terminal/glossary.ts`.
- Technical ecosystem language: [TECH.md](./TECH.md).
- Config schema: Effect Schema in `src/core/config/`; zod is migration debt. ADR 0008 is superseded.

### Imports Follow Ownership

```text
src/cli       -> src/core only; src/cli/index.ts may compose provider live layers
src/providers -> src/core/types + src/core/services only, plus vendor SDKs
src/core      -> src/apple and src/google only from live adapters under src/core/services
src/apple     -> src/core/types only, never src/core logic
src/google    -> src/core/types only, never src/core logic
```

### Types And Public Exports

`src/index.ts` is the package's only passive barrel. Internal modules import domain shapes directly from their owning files under `src/core/types/`. Apple generated shapes stay under `src/apple/generated/`; Google generated shapes stay inside the official Google client packages and their adapters.

### Providers

Adding a backend means implementing one of the five provider roles as Effect-returning methods and registering it through the ProviderRegistry live layer. Do not edit the pipeline to add a backend. Heavy SDKs stay lazy inside live layers or optional dependency helpers.

### Secrets

Key material never touches the repo or `~/.launch`. `.p8`, `.p12`, private keys, service-account JSON, and passwords live in the OS keychain/secret store or environment. Do not log, write, or commit secrets.

### Rules Digest

<!-- rules digest - full guide in CODE-STYLE.md; edit there -->

The full style guide is [CODE-STYLE.md](./CODE-STYLE.md), mirrored mechanically by [code-style.rules.json](./code-style.rules.json).

- **Effect everywhere in production.** Exported behavior returns `Effect`; pure logic -> `Effect.sync`, I/O -> `Effect.gen`.
- **Tagged failure values.** Expected failures are readonly tagged data in the Effect channel; no raw production throws or error classes.
- **Official platform services.** Use Effect FileSystem, Path, CommandExecutor, and Terminal; Launch services own domain policy only.
- **Services, not classes.** Use readonly service types with `Context.GenericTag` and `Layer`; tests provide hand `*Test` layers.
- **Prompting and I/O behind services.** No direct `@clack/prompts`, `fetch`, `fs`, `spawn`, `console.*`, or `process.env` outside live layers/entrypoints/tests/scripts.
- **CLI is thin.** Commander files parse names/flags and call a core Effect program; both interactive and non-interactive paths share that program.
- **Non-TTY never hangs.** Prompts require TTY or explicit flags/`--yes`; `--json` emits machine-clean output.
- **Effect Schema is config SSOT.** zod is temporary migration debt.
- **Purpose-grouped core.** New code goes under `src/core/<job>/`; no new flat-core files.
- **One public barrel.** `src/index.ts` is the package entrypoint; internal code imports owning modules directly.
- **Prose naming.** Generic bindings listed in `code-style.rules.json` are banned; `build` is reserved for the real build domain.
- **Comments explain hidden intent.** No narrated headers, change history, caller lists, or TSDoc that restates types.
- **Explicit control flow.** No ternary, `??`, or `||`; use guards, exhaustive switches, and named lookups.
- **Arrow module functions.** Authored module functions are const arrows declared before first use.
- **ASCII output.** Effect logging uses `[RUN]`, `[OK]`, `[WARN]`, `[ERROR]`, and `[SKIP]`; JSON stays machine-clean.
- **Tests are colocated.** Vitest, no snapshots, hand fakes, Effect `*Test` layers, shared testkit in `src/testkit/`.

## Style Is Enforced, Not Re-Explained

Formatting and generic TypeScript rules live in `tsconfig.json`, `biome.json`, and the Husky hook. Launch-specific rules live in `CODE-STYLE.md`, `code-style.rules.json`, and `scripts/dev/check-code-style.mjs`; the authored tree is enforced globally with generated artifacts excluded.

## Before You Call A Change Done

```bash
pnpm typecheck && pnpm lint && pnpm lint:style && pnpm docs:check && pnpm test && pnpm build
```

All six must be green. Add or update colocated tests for any new behavior.
(`npm run <script>` still works once dependencies are installed with **pnpm**; do not use `npm install` - this repo is `packageManager: pnpm@10` and only has `pnpm-lock.yaml`.)
