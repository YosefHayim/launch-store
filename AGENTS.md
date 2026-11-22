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
- **Domain language:** `src/terminal/glossary.ts`.

## Repo Layout - Who Owns What

One TypeScript / Node ESM package. Two kinds of code sit next to each other under `src/`.

| Path | Owns |
| --- | --- |
| `src/cli` | The door. Command names, flags, help text, `runCliProgram(...)`. |
| `src/apple` | App Store Connect. The client, `connect/`, and `generated/schema.ts` from Apple's OpenAPI zip. |
| `src/google` | Google Play. The client. Types come from `@googleapis`. |
| `src/listing`, `src/readiness`, `src/release`, `src/releaseTrain`, `src/plan`, `src/build`, `src/credentials` | The bridge. Launch's own product. These call the clients and decide what Launch does. |
| `src/store` | Store sync and the per-platform programs behind store commands. `store/apple` and `store/google` are those programs. The HTTP clients stay in `src/apple` and `src/google`. |
| `src/adopt`, `src/config`, `src/distribution`, `src/doctor`, `src/insights`, `src/migrate`, `src/portfolio`, `src/privacy`, `src/snapshot`, `src/stats` | The rest of the bridge. |
| `src/agents`, `src/mcp`, `src/terminal`, `src/docs` | Agent skills, the MCP server, glossary, and the config reference. |
| `src/services` | Paths, exec, logger, prompts, secrets, and the store client adapters. `services/stores` is the only door into `src/apple` and `src/google`. |
| `src/types` | Shared domain shapes. |
| `src/providers` | Swappable backends for build, storage, credentials, submit, and compute. |
| `src/testkit` | Shared test fakes. |
| `schema/` | Published `launch.config.schema.json`. `launch config` and the MCP tools read it. It ships in the npm package. Do not delete it. |

A file that performs one documented Apple or Google request belongs in `src/apple` or `src/google`. A file that decides something for Launch belongs in the job folder. Do not add `src/core` back.

`init`, `creds`, `build`, `release`, `plan`, `drift`, `sync`, and `adopt` are plain TypeScript. Their classes live in `src/build`, `src/credentials`, `src/launch-file`, and `src/store`. `src/release-command.ts` and `src/app-release.ts` stay in `src/` until that command is folded into its job.

`src/cli/commands/` is only the door for each job: `setup/`, `build/`, `credentials/`, `release/`, `store/` (with `apple/` and `google/`), `listing/`, `readiness/`, `insights/`, `agents/`, `terminal/`.

## Conventions A Linter Can't Infer

### Source Of Truth Files

- Usage and product direction: [README.md](./README.md).
- Domain language: runtime teaching text in `src/terminal/glossary.ts`.
- Config schema: `schema/launch.config.schema.json` is the published copy. `src/config/` loads and checks it.
- Root files: there is no `LICENSE` file and no `.env.example`. `package.json` keeps `"license": "MIT"`. `launch init` still writes a starter `.env.example` into the app being set up.

### Imports Follow Ownership

```text
src/cli       -> the job folder; src/cli/index.ts may wire provider adapters
src/providers -> src/types + src/services only, plus vendor SDKs
a job folder  -> src/apple and src/google only from the adapters under src/services/stores
src/apple     -> src/types only, never a job folder's logic
src/google    -> src/types only, never a job folder's logic
```

### Types And Public Exports

`src/index.ts` is the package's only passive barrel. Internal modules import domain shapes directly from their owning files under `src/types/`. Apple generated shapes stay under `src/apple/generated/`; Google generated shapes stay inside the official Google client packages and their adapters.

The service interfaces in `src/types/` ripple through every provider and the pipeline. Plan a change to them before writing code.

### Providers

Adding a backend means implementing one of the five provider roles as async methods and registering it through the provider registry. Do not edit the pipeline to add a backend. Heavy SDKs stay lazy inside the adapter or an optional dependency helper.

### Secrets

Key material never touches the repo or `~/.launch`. `.p8`, `.p12`, private keys, service-account JSON, and passwords live in the OS keychain/secret store or environment. Do not log, write, or commit secrets.

### Rules Digest

- **Commands are plain TypeScript.** They return `Promise` or a plain value and throw a readonly `{ _tag }` object. Imports use `@/`. A method that calls Apple or Google has a TSDoc `@see` for that exact endpoint. `launch.config.ts` and `defineConfig` stay the public names. `src/release-command.ts` and `src/app-release.ts` stay in `src/`.
- **New modules use function declarations.** An arrow only when a method is passed elsewhere and must keep `this`. Do not add `&&` or `||`. `??` and `?.` are allowed. Name each condition.
- **Registration is thin.** `src/cli/program.ts` registers the commands. Prompts require a TTY or `--yes`. `--json` emits one object. Only the entry sets exit codes.
- **JSON Schema is the config source.** Do not delete `schema/`.
- **Purpose-grouped jobs.** Later-command code goes under `src/<job>/`. Do not add `src/core` back.
- **One public barrel.** `src/index.ts` is the package entrypoint. Internal modules import the owning file.
- **Prose naming.** Generic bindings such as `data`, `result`, and `value` are banned. `build` is reserved for the real build domain.
- **Comments explain hidden intent.** No narrated headers or TSDoc that restates types.
- **ASCII output.** Logging uses `[RUN]`, `[OK]`, `[WARN]`, `[ERROR]`, and `[SKIP]`. JSON stays machine-clean.
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
