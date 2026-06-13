# AGENTS.md

Working rules for AI agents and contributors editing Relay. This file holds only what you **can't
infer** from the code and configs — the project-specific conventions and the commands that gate a
change. It deliberately does **not** restate style rules (those live in the tooling) or architecture
(that lives in [`PLAN.md`](./PLAN.md), the source of truth) or usage (that's [`README.md`](./README.md)).

## The shape of the repo

One TypeScript/Node ESM package. `src/cli` is thin commander wiring; `src/core` is the domain and the
build→submit pipeline; `src/providers` are the swappable backends; `src/apple` is the App Store Connect
integration. The full directory map and the reasoning behind every decision are in `PLAN.md` — read it
before changing direction.

## Conventions a tool can't enforce for you

- **`src/core/types.ts` is the single source of truth for domain types** and the four provider
  interfaces. Add or change a shape there, not inline in a feature file.
- **`src/core/glossary.ts` is the single source for teaching text** — it feeds both `relay explain`
  and the `--explain` step expansions. Edit term explanations only there; never duplicate them in docs.
- **Adding infrastructure = implement an interface + register it.** Implement one of
  `BuildEngine` / `StorageProvider` / `CredentialsProvider` / `Submitter` from `types.ts`, then register
  it in `src/providers/index.ts`. Do **not** touch `src/core/pipeline.ts` to add a backend — it selects
  providers by name from config. Lazy-load heavy SDKs inside the provider so a local-only run stays lean.
- **The config seam:** the user's `relay.config.ts` is loaded with jiti; the public API
  (`defineConfig` + config types) is re-exported from `src/index.ts` — the package `exports` entry.
  Keep `src/index.ts` re-exports only, with no logic.
- **All child processes go through `src/core/exec.ts`** (`run`/`capture`, `shell: false`, argument
  arrays). Never build a shell string or call `spawn`/`exec` directly.
- **Secrets never touch the repo or `~/.relay` metadata.** The `.p8`/`.p12`/private keys live in the
  macOS Keychain; `~/.relay` holds paths and ids only. Don't log, write, or commit key material, and
  honor `.gitignore`.

## Style is enforced, not documented

`tsconfig.json` (max-strict), `eslint.config.js` (`typescript-eslint` strict + stylistic),
`.prettierrc`, and `.husky/pre-commit` are the only source of truth for formatting and type rules — no
`any`, no needless `as`, JSDoc on exports, etc. Don't re-describe those rules anywhere; just run them.

## Before you call a change done

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

All four must be green. The husky pre-commit hook runs lint + format + typecheck, but it can be
bypassed and it doesn't run the tests — so run the line above yourself, and add a test for new logic
(`*.test.ts` beside the code). Keep changes KISS / YAGNI / DRY; extend the nearest sibling rather than
inventing a new file, util, or abstraction.
