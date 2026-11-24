# AGENTS.md

Working rules for AI agents and contributors editing **Launch**. This file holds only what you **can't infer** from the code and configs: module ownership, conventions a linter can't catch, and the validation gate every change must pass. Commands are `launch-store --help`. Product and config live in [README.md](./README.md) (keep agent rules out of it).

This is the only agent instructions file. [Claude Code](https://code.claude.com/docs/en/memory) reads it when the repo has no `CLAUDE.md`. [Codex](https://learn.chatgpt.com/docs/agent-configuration/agents-md) reads it from the repo root. [Cursor](https://cursor.com/docs/rules) reads it as the plain-markdown alternative to `.cursor/rules`. Do not add `CLAUDE.md`, `GEMINI.md`, or a second copy of these rules.

## Branching And PRs

- **Do not commit to `main`.** Branch as `feat|fix|refactor|chore|docs/<domain>/<slug>`, open a PR, label `domain:<domain>`, keep the gate green, delete the branch after merge.
- Domains: `foundation`, `config`, `credentials`, `build`, `apple`, `google`, `store`, `release`, `testflight`, `readiness`, `cli`, `docs`.

## Agent Skills

Config the engineering skills read.

- **Issue tracker:** GitHub issues on `YosefHayim/launch-store`, via the `gh` CLI.
- **Triage labels:** the five canonical triage roles, mapped to their default label strings.
- **Domain language:** `src/terminal/explain-terms.ts`.

## Repo Layout - Who Owns What

One TypeScript / Node ESM package. Two kinds of code sit next to each other under `src/`.

| Path | Owns |
| --- | --- |
| `src/cli` | The door. Command names, flags, help text, `runCliProgram(...)`. App Store and Play command programs live in `src/apple` and `src/google`. |
| `src/apple` | App Store Connect. The client, the resource modules, and the Launch command programs. |
| `src/types/apple/apple-api-types.ts` | Apple's generated OpenAPI types, one file. The client imports it. The generator is `scripts/generate-apple-types.ts`. Do not put this file under `src/apple`. |
| `src/google` | Google Play. The client and the Launch command programs. Types come from `@googleapis`. |
| `src/listing`, `src/readiness`, `src/release`, `src/release-train`, `src/plan`, `src/build`, `src/credentials` | The bridge. Launch's own product. These call the clients and decide what Launch does. |
| `src/store` | Shared store sync used by the Apple and Google programs. |
| `src/adopt`, `src/config`, `src/distribution`, `src/insights`, `src/migrate`, `src/portfolio`, `src/privacy`, `src/snapshot`, `src/stats` | The rest of the bridge. |
| `src/terminal`, `src/docs` | Explain terms, console links, terminal commands, and the config reference. |
| `src/services` | Paths, exec, logger, prompts, secrets, and the store client adapters. `services/stores` is the door into the Apple and Google HTTP clients. |
| `src/types` | Launch's own shapes. App Store Connect resource shapes live in `src/types/apple/`, grouped the way Apple's docs group them. Play resource shapes live in `src/types/google/`, grouped the way the Play Developer API groups its REST resources. |
| `src/providers` | Swappable backends for build, storage, credentials, submit, and compute. |
| `src/testkit` | Shared stand-ins the tests import. Vitest and Jest treat `*.test.*` and `*.spec.*` as suites to run, so these files are named for the job and do not use that suffix. |
| `schema/` | Published `launch.config.schema.json`. `launch-store config` reads it. It ships in the npm package. Do not delete it. |

A file that performs one documented Apple or Google request belongs in `src/apple` or `src/google`. A file that decides something for Launch belongs in the job folder. Do not add `src/core` back.

`init`, `creds`, `build`, `release`, `plan`, `drift`, `sync`, and `adopt` are plain TypeScript. Their classes live in `src/build`, `src/credentials`, `src/launch-file`, and `src/store`. `launch-store release` is `src/cli/commands/release/release.ts` calling `src/release/release-command.ts`.

`src/cli/commands/` registers each job: `setup/`, `build/`, `credentials/`, `release/`, `store/`, `listing/`, `readiness/`, `insights/`. Explain, open, and completion are `TerminalCommands` in `src/terminal/terminal-commands.ts`. App Store command programs live in `src/apple`. Play command programs live in `src/google`. Shared store sync stays in `src/store`. The Apple type generator stays in `scripts` and writes `src/types/apple/apple-api-types.ts`.

## Conventions A Linter Can't Infer

### Source Of Truth Files

- Product direction: [README.md](./README.md). Commands are `launch-store --help`.
- Domain language: runtime teaching text in `src/terminal/explain-terms.ts`.
- Config schema: `schema/launch.config.schema.json` is the published copy. `src/config/` loads and checks it. The root `launch.config.ts` is the full example of every field a developer can set.
- Root files: there is no `LICENSE` file, no `.env.example`, and no `launch.config.example.ts`. The root sample is `launch.config.ts`. `package.json` keeps `"license": "MIT"`. `launch-store init` still writes a starter `.env.example` into the app being set up.

### Imports Follow Ownership

```text
src/cli       -> the job folder; src/cli/index.ts may wire provider adapters
src/providers -> src/types + src/services only, plus vendor SDKs
a job folder  -> src/apple and src/google. HTTP clients are reached through src/services/stores
src/apple     -> the client stays on src/types. A Launch program may use src/store/shared
src/google    -> the client stays on src/types. A Launch program may use src/store/shared
```

### Types And Public Exports

`src/index.ts` is the package's only passive barrel. Internal modules import domain shapes directly from their owning files under `src/types/`. Apple generated shapes stay in `src/types/apple/apple-api-types.ts`. Google generated shapes stay inside the official Google client packages and their adapters.

The service interfaces in `src/types/` ripple through every provider and the pipeline. Plan a change to them before writing code.

### Providers

Adding a backend means implementing one of the five provider roles as async methods and registering it through the provider registry. Do not edit the pipeline to add a backend. Heavy SDKs stay lazy inside the adapter or an optional dependency helper.

### Secrets

Key material never touches the repo or `~/.launch`. `.p8`, `.p12`, private keys, service-account JSON, and passwords live in the OS keychain/secret store or environment. Do not log, write, commit, or print secrets. Do not print a resolved environment: names and values both leak into an agent transcript.

### Rules Digest

- **Commands are plain TypeScript.** They return `Promise` or a plain value. The explain, open, and completion commands throw `new Error`. `CommandExit` is still the process exit code. Other failures are still a readonly `{ _tag }` object. File names are kebab-case (`build-command.ts`). Every local import is a relative path ending in `.ts` (`./file.ts`, `../file.ts`). TypeScript 5.7 [`rewriteRelativeImportExtensions`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-7.html#path-rewriting-for-relative-paths) rewrites that to `.js` on emit. Do not import through `@/`. The same page says `@/file.ts` is not rewritten and does not work, and `tsc` reports TS2877. A runtime file URL such as `new URL('../index.js', import.meta.url)` stays `.js`, because Node loads the emitted file and that string is not an import. Biome's import-extension rule stays off so it does not demand the runtime `.js` extension in source. Do not add a `#` import map. A published package keeps the `.js` path it documents. A method that calls Apple or Google has a TSDoc `@see` for that exact endpoint. `launch.config.ts` and `defineConfig` stay the public names. `launch-store release` stays `src/release/release-command.ts`.
- **New modules use function declarations.** An arrow only when a method is passed elsewhere and must keep `this`. Do not add `&&` or `||`. Comparisons use `==` and `!=`. A missing value is `== null`. `??` and `?.` are allowed. Name each condition. A `SCREAMING_SNAKE` constant is only for a literal used twice or more in that file. A literal used once stays inline. A number used once is a camelCase const next to that use.
- **Registration is thin.** `src/cli/program.ts` registers the commands. Prompts require a TTY or `--yes`. `--json` emits one object. Only the entry sets exit codes.
- **JSON Schema is the config source.** Do not delete `schema/`.
- **Purpose-grouped jobs.** Later-command code goes under `src/<job>/`. Do not add `src/core` back.
- **One public barrel.** `src/index.ts` is the package entrypoint. Internal modules import the owning file.
- **Prose naming.** Generic bindings such as `data`, `result`, and `value` are banned. `build` is reserved for the real build domain.
- **Comments explain hidden intent.** No narrated headers or TSDoc that restates types.
- **ASCII output.** Logging uses `[RUN]`, `[OK]`, `[WARN]`, `[ERROR]`, and `[SKIP]`. JSON stays machine-clean.
- **Tests are colocated.** Vitest, no snapshots, hand fakes in `src/testkit/`. A test covers the contract a caller sees: inputs, outputs, errors, and side effects ([Vitest: testing in practice](https://vitest.dev/guide/learn/testing-in-practice.html)). Do not add a test that only copies a catalog, checks README prose, or asserts which names a module exports. A function that production never calls, and a test that only exists to call it, do not stay.

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
