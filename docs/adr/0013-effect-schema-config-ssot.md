# ADR 0013 — Effect Schema Config SSOT

- **Status:** Accepted — direction set in a `/grill-me-code-style-with-docs` session. — 2026-07-07
- **Supersedes:** [ADR 0008](./0008-adopt-zod-config-ssot.md)

## Context

ADR 0008 adopted zod as the config source of truth. The broader migration now makes Effect the runtime backbone, including typed errors and boundary parsing.

## Decision

- Effect Schema is the source of truth for `launch.config.ts` and external boundary schemas.
- Config parsing returns Effects and maps parse failures into tagged errors.
- zod is temporary migration debt and should be removed after the schema migration.
- `@effect/platform` stays because I/O boundaries are moving to Effect services.

## Consequences

- Config parsing composes with the same runtime as the rest of Launch.
- ADR 0008 remains historical context but no longer describes the old decision as target architecture.
- **2026-07-19:** zod removed from the package. Domain types are plain TypeScript interfaces under
  `src/core/types/`; runtime validation and JSON Schema generation both use `LaunchConfigEffectSchema`
  (`scripts/gen-docs.ts` → `JSONSchema.make`, with `$defs` normalized to draft-07 `definitions`).
  Field and type descriptions live as Effect Schema annotations and emit into the committed JSON Schema
  with no description-merge bridge.
