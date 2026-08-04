# ADR 0012 - CLI Dual-Mode Effect Programs

- **Status:** Accepted - direction set in a `/grill-me-code-style-with-docs` session. - 2026-07-07

## Context

Launch is both a human CLI and an automation surface for CI/agents. The existing command tree uses Commander and Clack, but prompt policy and orchestration are spread across CLI and core files.

## Decision

- `src/cli/commands/*` files are Commander wiring only.
- Both interactive and flag-driven paths call the same core Effect program.
- Clack is only the live implementation of `PromptService`; core code depends on `PromptService`, not `@clack/prompts`.
- Bare `launch` in a TTY opens the wizard while bare non-TTY execution prints help and exits without prompting.
- Explicit non-TTY commands require complete flags and `--yes` for confirmations or fail with a typed non-interactive error.
- `--json` output contains no banners, spinners, or prose.

## Exit Codes

- `0` success.
- `1` unexpected/internal failure.
- `2` planned drift, check failure, or validation failure for check-style commands.
- `3` missing confirmation in non-TTY / `--yes` required.
- `4` missing credentials, config, or environment.

## Consequences

- Commands become scriptable and testable.
- The wizard, flags, MCP, and future agents can share domain programs.
- Destructive, expensive, or externally visible actions have one confirmation policy.
