---
name: run-the-gate
description: Use when finishing or verifying a change to launch-store - run the full typecheck, lint, test, build, and docs gate that must be green before a change is done or a PR merges.
---

# Run the validation gate

## Use this when

- you finished a change and need to confirm it's green before calling it done
- CI failed and you want to reproduce the gate locally
- before opening or squash-merging a PR

## Steps

1. `pnpm typecheck && pnpm lint && pnpm lint:style && pnpm docs:check && pnpm test && pnpm build` - the six-part gate from `AGENTS.md` (`lint` is Biome, `lint:style` is Launch-specific, and `docs:check` guards generated docs).
2. If `docs:check` fails, run `pnpm docs:gen` and commit the generated docs (`docs/commands.md`, `llms.txt`, `.cursor/rules/*`, `.claude/skills/*`, README badges, and config docs).

All gates must be green before a change is done. The husky pre-commit hook runs lint + format + typecheck but **not** the tests and **can** be bypassed, so run the full line yourself. Add a `*.test.ts` beside any new logic.

See [AGENTS.md](../../../AGENTS.md) -> “Before you call a change done”.
