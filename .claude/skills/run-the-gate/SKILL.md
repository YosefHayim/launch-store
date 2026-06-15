---
name: run-the-gate
description: Use when finishing or verifying a change to launch-store — run the full typecheck, lint, test, build, format, and docs gate that must be green before a change is done or a PR merges.
---

# Run the validation gate

## Use this when

- you finished a change and need to confirm it's green before calling it done
- CI failed and you want to reproduce the gate locally
- before opening or squash-merging a PR

## Steps

1. `npm run typecheck && npm run lint && npm run test && npm run build` — the four core gates.
2. `npm run format:check` — prettier; CI enforces it even though the husky pre-commit hook formats on commit, so run it yourself before pushing.
3. `npm run docs:check` — fails if the generated docs (`docs/commands.md`, `llms.txt`, `.cursor/rules/*`, `.claude/skills/*`, README badges) drifted from the CLI; run `npm run docs:gen` and commit the result if it does.

All gates must be green before a change is done. The husky pre-commit hook runs lint + format + typecheck but **not** the tests and **can** be bypassed, so run the full line yourself. Add a `*.test.ts` beside any new logic.

See [AGENTS.md](../../../AGENTS.md) → “Before you call a change done”.
