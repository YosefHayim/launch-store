---
name: run-the-gate
description: Use when finishing or verifying a change to launch-store - run the full typecheck, lint, test, and build gate that must be green before a change is done or a PR merges.
---

# Run the validation gate

## Use this when

- you finished a change and need to confirm it's green before calling it done
- CI failed and you want to reproduce the gate locally
- before opening or squash-merging a PR

## Steps

1. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` - the gate from `AGENTS.md` (`lint` is Biome). `pnpm check` runs the same gate.

All gates must be green before a change is done. The husky pre-push hook runs `pnpm check`, which is that same gate. Add a `*.test.ts` beside any new logic.

See [AGENTS.md](../../../AGENTS.md) -> “Before you call a change done”.
