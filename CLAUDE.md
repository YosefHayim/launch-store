# CLAUDE.md

@AGENTS.md

The line above imports [`AGENTS.md`](./AGENTS.md) — the working rules, module ownership, the code
patterns for adding a backend, and the validation gate. That file is the source of truth for editing
this repo; the notes below are Claude-specific.

## Claude-specific notes

- The provider interfaces in `src/core/types.ts` ripple through every provider and the pipeline. For
  a change that touches them, plan the edit first (plan mode) before writing code.
- `README.md` owns user-facing usage and onboarding — keep agent rules out of it.

## Agent skills

Config the engineering skills read. Everything under `docs/agents/` is tracked even though the rest
of `docs/` is local-only.

### Issue tracker

Issues live as GitHub issues on `YosefHayim/launch-store`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, mapped to their label strings (defaults, unchanged). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `language.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
