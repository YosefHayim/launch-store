# CLAUDE.md

@AGENTS.md

The line above imports [`AGENTS.md`](./AGENTS.md) — the working rules, module ownership, and the
validation gate. The doc family:

| Doc | Role |
|-----|------|
| [`PROJECT.md`](./PROJECT.md) | Purpose, direction, non-goals |
| [`CONTEXT.md`](./CONTEXT.md) | Architecture and orientation map |
| [`LANGUAGE.md`](./LANGUAGE.md) | Domain glossary — the only terms to use |
| [`CODE-STYLE.md`](./CODE-STYLE.md) | How code is written (Effect, prose naming, patterns) |
| [`AGENTS.md`](./AGENTS.md) | Working rules for contributors and agents |
| [`TECH-GLOSSARY.md`](./TECH-GLOSSARY.md) | React Native / Expo / Apple / Google stack terms |

## Claude-specific notes

- The service interfaces in `src/core/types/` ripple through every provider and the pipeline. For
  a change that touches them, plan the edit first (plan mode) before writing code.
- `README.md` owns user-facing usage and onboarding — keep agent rules out of it.
- **All new code must follow CODE-STYLE.md** — full Effect, prose naming, typed errors.
- Rewrite existing code on contact to the new style.

## Agent skills

Config the engineering skills read. Everything under `docs/agents/` is tracked even though the rest
of `docs/` is local-only.

### Issue tracker

Issues live as GitHub issues on `YosefHayim/launch-store`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, mapped to their label strings (defaults, unchanged). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `LANGUAGE.md` + `TECH-GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
