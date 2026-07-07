# CONTEXT.md

Architecture and orientation for **Launch** — the map agents and contributors read before exploring code.

- **What it is and where it's going** → [`PROJECT.md`](./PROJECT.md)
- **Domain terms (the glossary)** → [`LANGUAGE.md`](./LANGUAGE.md)
- **Code style and patterns** → [`CODE-STYLE.md`](./CODE-STYLE.md)
- **Working rules for contributors** → [`AGENTS.md`](./AGENTS.md)
- **React Native / Expo / Apple / Google stack** → [`TECH-GLOSSARY.md`](./TECH-GLOSSARY.md)

---

## Ecosystem primer

If you're new to this stack: one TypeScript/React codebase (_React Native_) runs as a native iOS +
Android app. _Expo_ sits on top so you describe the app in `app.json`. `expo prebuild` generates real
native projects. On iOS, _Xcode_ + _fastlane_ + _CocoaPods_ compile and sign. On Android, _Gradle_ + a
JDK. Launch orchestrates this entire chain from `launch.config.ts`.

EAS (Expo Application Services) is the paid cloud Launch replaces — same pipeline, your own hardware, $0.

## The core flow: build → sign → submit

`src/core/build/pipeline.ts` is the single linear spine:

1. **Resolve** — pick app + profile + env from `launch.config.ts`
2. **Prebuild** — `expo prebuild` only if no native project exists
3. **Credentials** — signing assets from OS keychain (provisioning on first run)
4. **Build** — fastlane `gym` (iOS) or Gradle `:app:bundleRelease` (Android)
5. **Size report** — per-device download/install from Xcode thinning or bundletool
6. **Store** — copy artifact into local (or pluggable) storage
7. **Submit** — upload to TestFlight / Play testing track (separate `launch release` for public)

`--dry-run` rehearses the flow with no network, build, or account changes.

## Architecture / module map

Launch is moving from a flat `src/core/*.ts` tree to a purpose/job layout. Treat this as target architecture: current flat files are migration debt, not precedent.

```text
src/
├── cli/              Thin Commander wiring — command names, flags, help, runCliProgram
├── core/
│   ├── build/        Pipeline, build flags, fingerprint, logs, diagnostics, remote/eas handoff
│   ├── release/      Release, rollout, release train, TestFlight/public release
│   ├── store/        Store sync, catalog/product/offers/pricing/reviews/reports across stores
│   ├── readiness/    Doctor/readiness/probes/preflight
│   ├── config/       Effect Schema config/load/scaffold/semantics/docs
│   ├── credentials/  Accounts, secrets, keychain, signing assets
│   ├── distribution/ Install manifests, OTA updates, storage-facing helpers
│   ├── agents/       Agent skills scaffolding
│   ├── mcp/          MCP server + tools
│   ├── dashboard/    Terminal dashboard state/rendering
│   ├── docs/         Generated command/config docs
│   ├── services/     Effect service Tags + Live/Test layers
│   └── types/        Exported domain shapes + index.ts barrel
├── providers/        Swappable backend implementations
├── apple/            ASC transport + wire/resource DTOs
├── google/           Google Play transport + wire/resource DTOs
└── testkit/          Shared test fakes + Effect test layers
```

## The provider / service model

Infrastructure is swappable behind five provider roles. Target implementations are Effect-returning service contracts registered through `Context.Tag` + `Layer`:

| Service | Owns |
|---------|------|
| `BuildEngine` | Compile + archive + sign |
| `StorageProvider` | Artifact put/list/url |
| `CredentialsProvider` | Keychain read/write |
| `Submitter` | Upload to store |
| `ComputeHost` | Remote Mac lifecycle |

Adding a backend = implement the provider contract in `src/providers/<role>/<name>.ts`, register it in the ProviderRegistry live layer, and provide a `*Test` layer/fake for tests. Never touch the pipeline to add a backend.

The **build platform** and the **store** are decoupled: one Android build can fan out to multiple stores.
The four Apple platforms share one ASC account, cert, and submitter — they differ only in Xcode
destination and signing profile type (centralized in `src/core/platform.ts`).

## State and secrets

- **Secrets in OS keychain only.** `.p8`/`.p12`/private keys never touch the repo.
- **`~/.launch`** holds non-secret paths, ids, caches (artifacts, credentials index, logs).
- **iOS needs a Mac.** Off-Mac: `--remote aws` (EC2 Mac), `--remote user@host` (SSH), or `buildEngine: "eas"`.
- **Android builds anywhere** a JDK runs.

## Where to look first

| Task | Start here |
|------|-----------|
| New command | `src/cli/commands/` + `src/cli/program.ts` |
| End-to-end flow | `src/core/build/pipeline.ts` |
| New backend | `src/core/types/providers.ts` + `src/providers/<role>/` |
| Domain terms | `src/core/glossary.ts` (runtime) + `LANGUAGE.md` |
| Code style | `CODE-STYLE.md` |
| Teaching text | `src/core/glossary.ts` |
