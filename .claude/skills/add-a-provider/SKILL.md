---
name: add-a-provider
description: Use when adding or changing a build, storage, credentials, submit, or compute backend in launch-store — implement one of the five provider interfaces and register it, without touching the pipeline.
---

# Add a provider backend

## Use this when

- adding a new storage / build / submit / credentials / compute backend
- wiring a new SDK behind one of Launch's provider interfaces

## Steps

1. Pick one of the five interfaces in `src/core/types.ts`: `BuildEngine` / `StorageProvider` / `CredentialsProvider` / `Submitter` / `ComputeHost`.
2. Implement it as a named object in `src/providers/<kind>/<name>.ts`, setting `name` to the value users put in `launch.config.ts`.
3. Register it in `src/providers/index.ts` (`registerBuiltins()`). The pipeline resolves a provider by its `name`, so you never edit `src/core/pipeline.ts` to add one.
4. Lazy-load any heavy or optional SDK through `requireOptional` in `src/core/optionalDep.ts`, so a missing package becomes an actionable install hint instead of a stack trace.
5. Add a `*.test.ts` beside the provider, then run the gate (see the `run-the-gate` skill).

Adding a backend never edits the pipeline — that is the whole point of the registry: implement the interface, register the name, done.

See [AGENTS.md](../../../AGENTS.md) → “Adding a backend = implement an interface + register it” for the worked S3 example.

## Cautions

- All child processes go through `src/core/exec.ts` (`run` / `capture`, `shell: false`, explicit argv) — never build a shell string or call `spawn` / `exec` directly.
- Secrets stay in the OS keychain; `~/.launch` holds non-secret paths and ids only. Don't log, write, or commit key material.
