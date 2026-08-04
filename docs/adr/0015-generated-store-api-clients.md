# ADR 0015 - Generated Store API Clients

- **Status:** Accepted - approved in the code-style Planpage review. - 2026-08-03

## Context

App Store Connect publishes an OpenAPI specification, while Google publishes maintained TypeScript clients for Android Publisher and Play Developer Reporting. Launch previously hand-maintained many Google wire shapes and duplicated Apple screenshot metadata across registries.

## Decision

- Apple wire types remain a checked-in `openapi-typescript` artifact under `src/apple/generated/` with the official source URL and reproduction command recorded in the generated header.
- Google transport wrappers use `@googleapis/androidpublisher` and `@googleapis/playdeveloperreporting`
  generated clients and types inside `src/google/`; core-facing Live adapters stay under
  `src/core/services/`.
- Vendor-generated types never become Launch domain types.
- Core schemas validate only the vendor fields a Launch program consumes and adapters map those fields into Launch-owned readonly shapes.
- One Apple screenshot asset-target registry owns screenshot keys, labels, display specifications, and optional preview types.

## Consequences

- Google Play has generated coverage without a second local Discovery generator.
- Vendor API changes are isolated to generation or adapter boundaries.
- Adding a screenshot target or consumed store field has one source-of-truth edit.
