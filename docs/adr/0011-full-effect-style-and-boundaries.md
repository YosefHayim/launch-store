# ADR 0011 - Full Effect Style And Boundaries

- **Status:** Accepted - direction set in a `/grill-me-code-style-with-docs` session. - 2026-07-07
- **Supersedes:** parts of older guidance that allowed Promise-returning provider contracts as the desired state.

## Context

Launch is mid-migration: much of the current code still uses `async/await`, raw `throw new Error`, global provider registries, and direct I/O. The desired state is now explicit in `CODE-STYLE.md`.

## Decision

- Production behavior returns `Effect`.
- Expected failures are readonly tagged data values carried in the Effect error channel; Launch does not define error classes.
- Infrastructure is modeled as `Context.GenericTag` services with `Live` and `Test` layers.
- Filesystem, path, child-process, and terminal mechanics use the official `@effect/platform` and `@effect/platform-node` services.
- Launch-owned services remain only where the repository owns domain policy: store transports, credentials, prompts, providers, logging presentation, time, and randomness.
- Provider interfaces remain the extension model, but provider methods return Effects and provider lookup is a service, not process-global mutable state.

## Consequences

- Tests provide layers instead of mutating registries.
- Migrated modules can compose cancellation, retries, logging, and scoped cleanup.
- The authored tree is migrated as one change and the style gate prevents Promise compatibility twins from returning.
