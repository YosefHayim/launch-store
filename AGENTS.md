# AGENTS.md

Working rules for AI agents and contributors editing **Launch**. This file holds only what you **can't infer** from the code and configs: module ownership, conventions a linter can't catch, and the validation gate every change must pass. Usage lives in [README.md](./README.md) (keep agent rules out of it).

This is the only agent instructions file. [Claude Code](https://code.claude.com/docs/en/memory) reads it when the repo has no `CLAUDE.md`. [Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md) reads it from the repo root. Do not add `CLAUDE.md`, `GEMINI.md`, or a second copy of these rules.

## Branching And PRs

- **Do not commit to `main`.** Branch as `feat|fix|refactor|chore|docs/<domain>/<slug>`, open a PR, label `domain:<domain>`, keep the gate green, delete the branch after merge.
- Domains: `foundation`, `config`, `credentials`, `build`, `apple`, `google`, `store`, `release`, `testflight`, `readiness`, `agents`, `cli`, `docs`.

## Agent Skills

Config the engineering skills read.

- **Issue tracker:** GitHub issues on `YosefHayim/launch-store`, via the `gh` CLI.
- **Triage labels:** the five canonical triage roles, mapped to their default label strings.
- **Domain language:** `src/core/terminal/glossary.ts`.

## Repo Layout - Who Owns What

One TypeScript / Node ESM package. Top-level ownership:

| Path | Owns |
| --- | --- |
| `schema/` | Published `launch.config.schema.json`. `launch config` and the MCP tools read it. It ships in the npm package. Do not delete it. |
| `src/build`, `src/credentials`, `src/launch-file`, `src/store` | Ship-path classes for build, creds, init, plan, drift, sync, and adopt. Plain TypeScript. |
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
 distribution/   # install manifests, OTA updates, storage-facing distribution helpers
 docs/           # config reference renderer
 doctor/         # doctor context/inspection
 insights/       # review/vitals aggregation
 listing/        # listing drafts/apply logic and screenshot asset specifications
 mcp/            # MCP server/tools
 migrate/        # EAS/fastlane migration helpers
 plan/           # config-vs-store planning/drift
 portfolio/      # every app on this machine: discover, tag, list
 privacy/        # privacy parsing/reconciliation/nutrition labels
 readiness/      # store readiness/probes/preflight
 release/        # release, rollout, TestFlight/public release
 releaseTrain/   # release-train records/guards/orchestration
 services/       # Launch-owned Effect service contracts + Live/Test layers
   platform/       # the machine: os, paths, exec, logger, prompt, progress
   stores/         # live Apple and Google clients, the only door to src/apple and src/google
   credentials/    # keychain and local credential stores
   providerSupport/ # the provider registry and the support code providers plug into
 snapshot/       # live store snapshot/diff/source capture
 stats/          # download and sales stats feeds and their local store
 store/          # store sync, catalog/product/offers/pricing/reviews/reports across stores
   apple/          # App Store Connect programs
   google/         # Google Play programs
   shared/         # sync, reconcile, store config and app selection used by both
 terminal/       # CLI presentation helpers, glossary, completion
 types/          # exported domain shapes imported from owning modules
```

Do not create flat `src/core/*.ts` files. Pick the purpose folder that owns the job.

`src/cli/commands/` follows the same jobs: `setup/`, `build/`, `credentials/`, `release/`, `store/` (with `apple/` and `google/`), `listing/`, `readiness/`, `insights/`, `agents/`, `terminal/`.

## Conventions A Linter Can't Infer

### Source Of Truth Files

- Usage and product direction: [README.md](./README.md).
- Domain language: runtime teaching text in `src/core/terminal/glossary.ts`.
- Config schema: Effect Schema in `src/core/config/` is the source. `schema/launch.config.schema.json` is the published copy.
- Root files: there is no `LICENSE` file and no `.env.example`. `package.json` keeps `"license": "MIT"`. `launch init` still writes a starter `.env.example` into the app being set up.

### Imports Follow Ownership

```text
src/cli       -> src/core only; src/cli/index.ts may compose provider live layers
src/providers -> src/core/types + src/core/services only, plus vendor SDKs
src/core      -> src/apple and src/google only from live adapters under src/core/services/stores
src/apple     -> src/core/types only, never src/core logic
src/google    -> src/core/types only, never src/core logic
```

### Types And Public Exports

`src/index.ts` is the package's only passive barrel. Internal modules import domain shapes directly from their owning files under `src/core/types/`. Apple generated shapes stay under `src/apple/generated/`; Google generated shapes stay inside the official Google client packages and their adapters.

The service interfaces in `src/core/types/` ripple through every provider and the pipeline. Plan a change to them before writing code.

### Providers

Adding a backend means implementing one of the five provider roles as Effect-returning methods and registering it through the ProviderRegistry live layer. Do not edit the pipeline to add a backend. Heavy SDKs stay lazy inside live layers or optional dependency helpers.

### Secrets

Key material never touches the repo or `~/.launch`. `.p8`, `.p12`, private keys, service-account JSON, and passwords live in the OS keychain/secret store or environment. Do not log, write, or commit secrets.

### Rules Digest

- **Ship path is plain TypeScript.** `init`, `creds`, `build`, `release`, `plan`, `drift`, `sync`, and `adopt` do not use Effect. Imports inside that path use `@/`. A method that calls Apple or Google has a TSDoc `@see` for that exact endpoint. `launch.config.ts` and `defineConfig` stay the public names. `src/release-command.ts` and `src/app-release.ts` stay in `src/`. Later commands still return `Effect`.
- **New modules use function declarations.** An arrow only when a method is passed elsewhere and must keep `this`. Do not add `&&` or `||`. `??` and `?.` are allowed. Name each condition.
- **Effect commands stay services.** Expected failures are readonly tagged data. Use Effect FileSystem, Path, CommandExecutor, and Terminal there, and hand `*Test` layers in tests. Do not apply that shape to the ship path.
- **Registration is thin.** `src/cli/program.ts` registers the ship-path classes and the later commands. Prompts require a TTY or `--yes`. `--json` emits one object. Only the entry sets exit codes.
- **Effect Schema is the config source.** Do not delete `schema/`.
- **Purpose-grouped core.** Later-command code goes under `src/core/<job>/`. No new flat `src/core/*.ts` files.
- **One public barrel.** `src/index.ts` is the package entrypoint. Internal modules import the owning file.
- **Prose naming.** Generic bindings such as `data`, `result`, and `value` are banned. `build` is reserved for the real build domain.
- **Comments explain hidden intent.** No narrated headers or TSDoc that restates types.
- **ASCII output.** Effect logging uses `[RUN]`, `[OK]`, `[WARN]`, `[ERROR]`, and `[SKIP]`. JSON stays machine-clean.
- **Tests are colocated.** Vitest, no snapshots, hand fakes, shared testkit in `src/testkit/`. A test covers the contract a caller sees: inputs, outputs, errors, and side effects ([Vitest: testing in practice](https://vitest.dev/guide/learn/testing-in-practice.html)). Do not add a test that only copies a catalog, checks README prose, or asserts which names a module exports.

## Style Is Enforced, Not Re-Explained

Formatting and generic TypeScript rules live in `tsconfig.json`, `biome.json`, and the Husky hook. The authored tree is enforced globally with generated artifacts excluded.

## Before You Call A Change Done

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must be green. Add or update colocated tests for any new behavior.
Install with npm, yarn, or pnpm. Lockfiles stay untracked (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`), so the three tools do not fight over a committed lockfile.

## Local CI

CI runs on `pull_request`, on `push` to main (markdown-only pushes skip it) and on `workflow_dispatch`.
The Husky pre-push hook runs `pnpm check` (lint, typecheck, test, and build). Lint, style, and typecheck do not run in CI. A new worktree needs its own `npm install`, `yarn`, or `pnpm install` before its first push.
The `changes` job in `ci.yml` (`dorny/paths-filter`, `token: ''`) decides what runs:

- Docs-only changes skip every job, and `CI Gate` still passes.
- Test (`vitest run --project unit --changed`) checks only the changed unit files. The e2e project runs the built CLI, so it stays out of that step. Build and the CLI smoke test run in full when code changes. E2E runs when `src/` or `package.json` change.
- A change to the workspace file, `biome.json`, `tsconfig*.json`, `*.config.ts` or `.github/**`, and a manual run, run everything in full with coverage. A `package.json` change alone does not.
- `CI Gate` fails only when a job failed or was cancelled.
