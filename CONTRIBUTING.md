# Contributing to Launch

Thanks for helping build a local, no-subscription replacement for EAS Build. This guide is the
**how-to-work-on-it**; the **day-to-day conventions** live in [`AGENTS.md`](./AGENTS.md). This file
links to that rather than repeat it.

## Prerequisites

- **Node 20+** and npm.

That's all you need to work on the CLI and its tests. A real iOS build additionally needs a Mac with
Xcode + fastlane and an App Store Connect API key — but the test suite mocks those, so you can
contribute to most of Launch on any OS.

## Setup

```bash
git clone <your-fork>
cd launch
npm install          # also installs the husky pre-commit hook
npm run dev -- --help # run the CLI from source (tsx), no build needed
```

## The quality gate

Launch's codebase is the product's reference implementation, so it's kept provably clean. Two layers
enforce that:

- **Locally**, the husky pre-commit hook runs `lint-staged` (ESLint `--fix` + Prettier on staged
  files) then a full `typecheck`.
- **In CI** ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)), every push and PR re-runs the
  whole gate on Node 20 and 22 — because the local hook can be bypassed with `--no-verify`.

Run the same checks before you push:

```bash
npm run typecheck     # tsc --noEmit, max-strict
npm run lint          # biome check (lint + format)
npm run test          # vitest
npm run build         # emits dist/ (production code only)
```

Style and types are owned entirely by `tsconfig.json` and `biome.json` — fix
what they flag rather than working around it.

## Tests

Tests use **[Vitest](https://vitest.dev)** and live beside the code they cover (`src/**/*.test.ts`).

```bash
npm run test          # run once
npm run test:watch    # watch mode while developing
npm run test:coverage # with a coverage summary (what CI surfaces)
```

The suite covers the **reliability-critical paths**: config loading + app auto-discovery, `.env`
validation and secret-name warnings, the provider registry, the glossary, the App Store Connect client
(JWT shape, request building, error parsing — `fetch` mocked), the pure build helpers (thinning-report
parse, export-options plist), and the full **`--dry-run` pipeline** as an end-to-end integration test
that asserts no network call or process spawn happens.

What the suite intentionally does **not** mock is the live `openssl` / `security` / `fastlane` shell
calls — asserting their exact arguments just re-encodes the implementation and goes brittle. Those are
verified by `launch build ios --dry-run` (which rehearses every step) and `launch doctor` (which checks
the toolchain and Apple account). **Add a test for any new logic you introduce.**

## Adding a backend (storage, build engine, credentials, submitter)

This is the extensibility story, and it's a small, well-defined change. To add (say) an S3 storage
provider:

1. **Find the interface** in [`src/core/types.ts`](./src/core/types.ts) — here, `StorageProvider`
   (`put` / `list` / `url`).
2. **Implement it** in `src/providers/storage/s3.ts`, using
   [`src/providers/storage/local.ts`](./src/providers/storage/local.ts) as the reference shape. Give it
   a unique `name` (`"s3"`). Lazy-`import()` the AWS SDK inside the methods so a local-only install
   never pulls it in.
3. **Register it** in [`src/providers/index.ts`](./src/providers/index.ts) via
   `registerStorageProvider(...)`.
4. **Select it** by name from a `launch.config.ts` (`storage: "s3"`). Nothing in
   `src/core/pipeline.ts` changes — the pipeline looks providers up by name.
5. **Add a test** beside it and run the gate.

The same five steps apply to a `BuildEngine`, `CredentialsProvider`, or `Submitter`.

## Pull requests

- Branch off `main`; keep the gate green.
- Write clear, imperative commit messages (`add s3 storage provider`, not `wip`).
- When you add a dependency or a non-obvious pattern, note the rationale (what, why over alternatives,
  the tradeoff) in the PR description — see Global development principles in the project standards.
- Keep changes within the **scope boundary** so they land in the right milestone (v1 is iOS →
  TestFlight; Android and cloud backends are designed-for but deferred).
- Never commit secrets. `.p8` / `.p12` / `.env` are git-ignored and belong in the Keychain.
