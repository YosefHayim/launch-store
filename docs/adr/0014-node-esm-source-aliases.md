# ADR 0014 - Node ESM Source Aliases

- **Status:** Accepted - approved in the code-style Planpage review. - 2026-08-03

## Context

Deep relative imports obscure Launch ownership, but TypeScript `paths` only changes type resolution and does not rewrite emitted JavaScript. Node package imports would solve runtime resolution with `#` specifiers, which Launch deliberately does not use.

## Decision

- Same-directory and one-parent imports remain relative.
- Deeper internal imports use `@core`, `@cli`, `@providers`, `@apple`, `@google`, and `@testkit` source aliases.
- `tsc-alias` rewrites those specifiers to relative Node ESM imports after `tsc` emits the package.
- The build gate executes the emitted CLI and public package entrypoint so an unresolved alias cannot ship.
- `src/index.ts` remains the only public passive barrel; aliases do not create new package export surfaces.

## Consequences

- Source imports communicate ownership without long parent traversals.
- Development, tests, emitted JavaScript, declarations, and package publishing must all prove the same resolution behavior.
- The build retains `tsc` rather than introducing a bundler solely for alias resolution.
