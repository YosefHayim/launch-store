---
name: add-a-command
description: Use when adding a new top-level `launch` command or subcommand - wire it as thin commander code and add a test.
---

# Add a launch CLI command

## Use this when

- adding a new `launch <command>` or subcommand

## Steps

1. Add the command as thin commander wiring in the job folder under `src/cli/commands/` (setup, build, release, store/apple...) and register its `register*Command` in `src/cli/program.ts`'s `buildProgram()`. Keep domain logic in the job folder under `src/`, not the CLI layer.
2. Add a `*.test.ts` beside the new logic, then run the gate.

Keep the command thin. Domain logic stays in the job folder under `src/`.

See [AGENTS.md](../../../AGENTS.md).
