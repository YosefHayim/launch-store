# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase. launch-store is **single-context**: one `CONTEXT.md` + `docs/adr/` at the repo root.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — what Launch is, how the build → sign → submit flow fits together, and **## Language** (Launch-specific domain terms).
- **`TECH-GLOSSARY.md`** at the repo root — the React Native / Expo / Apple / Google stack glossary (provisioning profile, AAB, keystore, track…). Use these terms; don't drift to synonyms.
- **`docs/adr/`** — read any ADRs that touch the area you're about to work in (created lazily as decisions get resolved).

If a file doesn't exist, **proceed silently** — don't flag its absence or suggest creating it upfront.

## File structure (single-context)

```
/
├── CONTEXT.md          ← project + architecture + ## Language
├── TECH-GLOSSARY.md    ← stack / ecosystem glossary
├── docs/adr/           ← architectural decision records (lazily created)
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test
name), use the term as defined in `CONTEXT.md` ## Language / `TECH-GLOSSARY.md`. The runtime source of truth for the
teaching copy is `src/core/glossary.ts`; the root docs are the human/agent-readable companion.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language
the project doesn't use (reconsider), or there's a real gap (note it).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0003 (manual signing only) — but worth reopening because…_
