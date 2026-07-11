# ADR 0011 — Full Effect Style And Boundaries

- **Status:** Accepted — direction set in a `/grill-me-code-style-with-docs` session. — 2026-07-07
- **Supersedes:** parts of older guidance that allowed Promise-returning provider contracts as the desired state.

## Context

Launch is mid-migration: much of the current code still uses `async/await`, raw `throw new Error`, global provider registries, and direct I/O. The desired state is now explicit in `CODE-STYLE.md`.

## Decision

- Production behavior returns `Effect`.
- Expected failures are `Data.TaggedError` values.
- Infrastructure is modeled as `Context.Tag` services with `Live` and `Test` layers.
- I/O is isolated behind services: filesystem, HTTP, child processes, secrets, prompts, logging, time, env, and randomness.
- Provider interfaces remain the extension model, but provider methods return Effects and provider lookup is a service, not process-global mutable state.

## Consequences

- Tests provide layers instead of mutating registries.
- Migrated modules can compose cancellation, retries, logging, and scoped cleanup.
- Old Promise modules remain migration debt and should be converted on contact.
