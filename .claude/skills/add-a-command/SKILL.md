---
name: add-a-command
description: Use when adding a new top-level `launch` command or subcommand — wire it as thin commander code and regenerate the docs the CLI surface drives.
---

# Add a launch CLI command

## Use this when

- adding a new `launch <command>` or subcommand
- a `docs:check` failure after changing the CLI surface

## Steps

1. Add the command as thin commander wiring in `src/cli/commands/` and register its `register*Command` in `src/cli/program.ts`'s `buildProgram()`. Keep domain logic in `src/core`, not the CLI layer.
2. Run `npm run docs:gen` — it introspects `buildProgram()` and regenerates `docs/commands.md`, `llms.txt`, the README stats badges, and the committed `.cursor/rules` / `.claude/skills`.
3. Commit the regenerated files; `npm run docs:check` (CI) fails if they drift.
4. Add a `*.test.ts` beside the new logic, then run the gate.

The docs are generated from the live `buildProgram()` in `src/cli/program.ts`, so a new command surfaces in the reference automatically once you run `docs:gen` — never hand-edit the generated files.

See [AGENTS.md](../../../AGENTS.md).
