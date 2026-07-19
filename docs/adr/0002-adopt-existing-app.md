# ADR 0002 — `launch adopt`: onboard an app that already ships

- **Status:** Accepted — v1 shipped (2026-07-19 audit). `launch adopt` + `src/core/adopt/` registry
  (products, capabilities, certs, listing) with plan → confirm → write. Future adopters remain YAGNI.
- **Context:** converged in a `/grill-me` session; this ADR is the decision record.

## Context

A developer who already has a released / TestFlight app and *then* installs Launch has no way to pull
their existing App Store Connect setup into config. Everything that reads ASC today reads it to
**compare against** config, never to **generate** it:

- `launch sync` (`core/ascSync.ts`) is **push-only and declarative** — config is the source of truth,
  reality is re-read each run, additive by default, plan-then-apply.
- `launch init` scaffolds a **blank commented template**; it detects app roots but reads nothing from
  ASC.
- `launch metadata pull` is the **only** ASC→local path, and only for listing text (fastlane
  `deliver download_metadata` → `store.config.json`).

The lower-level plumbing already exists: `ascClient` has every needed read (`getAppId`,
`findBundleId`, `listAppNames`, `listBundleIdCapabilities`, `listInAppPurchases`,
`listSubscriptionGroups`, `listDistributionCertificates`, `findProfileByName`, `listMerchantIds`), the
client already exposes provisioning-profile `profileContent`, and `credentials.ts` owns the signing
flow. What's missing is the **import direction** and a structure to hold it.

**Goal (locked):** a one-time **pull** that bootstraps config from a shipping app, honest about what
Apple's API can and can't return. Continuous two-way mirroring is rejected (YAGNI — it fights the
declarative model and needs a conflict layer we don't need).

## Decision

Add `launch adopt [--all] [--app <name>] [--dry-run] [--yes]` — the **pull counterpart of `sync`**.
The wizard offers it on detection; `init` points to it; the listing slice delegates to the existing
`metadata pull`. After adopt, config is the source of truth and `sync` carries changes back up
("auto-push" = run `sync`, in CI or manually). There is **no daemon and no two-way watcher**.

### Architecture — a per-domain adopter registry (mirrors the provider registry)

The scope is "everything the API offers that the config can hold," so it must be extensible, not a
god-function. Define an `Adopter` interface and register adopters like providers; the orchestrator
walks the registry and runs one shared plan→confirm→write. Adding `gameCenter` / `appClips` / `wallet`
later is a new file + one `register()` line — the orchestrator is never touched (the repo's documented
"implement an interface + register it" rule).

```ts
interface Adopter {
  domain: string;                                   // 'products'
  fidelity: "importable" | "advisory" | "detect";   // drives plan rendering + safety
  home: "launch.config" | "app.json" | "store.config" | "keychain";
  read(asc, app): Promise<PlannedWrite[]>;          // ASC -> planned writes (read-only)
}
```

### Detection

Local bundle-id lookup is primary: resolve each discovered app's bundle id, `getAppId` / `findBundleId`,
and offer adoption with a confirming signal ("12 builds, v2.1 live"). `--all` walks every app
`loadConfig` discovers (and can enumerate account-wide via `listAppNames`) to onboard a monorepo or
multi-app account in one pass. Detection does **not** gate strictly on TestFlight — a registered bundle
id with catalog/capabilities is worth adopting too.

### Write strategy — shared plan → confirm → write, per-item opt-in

Mirrors `sync`'s plan-then-apply (reuse the `act` / `ActionLog` / dry-run UX). Files the user owns are
never spliced blindly:

- **No `launch.config.ts`** → write a full commented file (extend `init`'s template).
- **Existing config** → write only per-item-confirmed gaps; never overwrite existing declarations.
- **`app.json`** static JSON → patch entitlements on confirm; **dynamic `app.config.js`** → print the
  block to paste.

### The four v1 adopters (by fidelity tier)

| Adopter | Tier | Source → home |
| --- | --- | --- |
| **products** | importable | `listInAppPurchases` + `listSubscriptionGroups` → `products[bundleId]` in `launch.config.ts`. Maps 1:1 to the existing `AppProducts` shape. |
| **capabilities** | advisory | Capability **types** from `listBundleIdCapabilities`; **values from the provisioning profile** (`profileContent` → `security cms -D` → plist `Entitlements`) → real app groups, iCloud container ids, merchant ids, `aps-environment`, associated-domains. Supplement with `/merchantIds` + capability `settings` (data-protection level, iCloud version). Flag `NEEDS_VALUE` only when genuinely absent. → `app.json` entitlements (per-capability opt-in). |
| **certs** | detect | `listDistributionCertificates` + profiles, each with a usability verdict (serial vs keychain via `describeStoredCredentials`). Link if the key is already local; else delegate the "add" to the existing creds flow (import `.p12` / `ensureSigningCredentials`, warning on Apple's cert limit); download+install the profile. Apple never returns the private key. |
| **listing** | importable | Delegates to existing `metadata pull` (`deliver download_metadata`) → `store.config.json`. No new code. |

Everything else (`gameCenter`, `appClips`, `wallet`, `availability`, `releaseAttributes`, …) is a
**future adopter**, deferred per YAGNI until asked.

### Why the profile is the capability-value source

Apple's OpenAPI spec (`core/asc/schema.ts`) has **no `appGroups` and no `cloudContainers` endpoint**,
and a capability carries only toggle `settings` (`ICLOUD_VERSION`, `DATA_PROTECTION_PERMISSION_LEVEL`,
`APPLE_ID_AUTH_APP_CONSENT`), never identifier values. The identifiers live in the **provisioning
profile's embedded `Entitlements` plist**, which the client already downloads as `profileContent`.
Extraction uses `security cms -D` + `plutil` through `core/exec.ts` (the existing `security` pattern).

### Re-run — stateless re-diff, no markers

Consistent with `sync`: every run reads live ASC + current local files, proposes only the delta, leaves
existing declarations untouched, and re-surfaces unresolved `NEEDS_VALUE` as warnings (never duplicated
or silently overwritten). No state file, no comment markers.

## Out of scope — structurally absent, not deferred

- **Continuous two-way sync / a watcher daemon** — rejected; `adopt` (pull) + `sync` (push) cover the
  loop without a conflict model.
- **Recovering a cert private key from Apple** — impossible; `adopt` detects + reports + delegates.
- **`associated-domains` when stored as a wildcard, and any custom entitlement** — neither the profile
  nor ASC carries the real value → `NEEDS_VALUE`, filled by hand.
- **Off-Mac capability-value recovery** — `security cms -D` is Mac-only; off-Mac the capabilities
  adopter degrades every value to `NEEDS_VALUE` (the Apple flow is Mac-centric anyway).
- **Future adopters** (`gameCenter` / `appClips` / `wallet` / `availability` / …) — the registry exists
  for them; they are not v1.

## Consequences

- **+** A developer with a shipping app gets a populated, reviewable config in one command, then drives
  everything forward through the existing `sync`.
- **+** The registry keeps the surface honest and extensible — new ASC domains are additive, the
  orchestrator is stable, and each adopter declares its own fidelity so the plan never over-promises.
- **+** Reuses `sync`'s plan UX, `credentials.ts`, and `metadata pull` — little net-new surface.
- **−** `ascClient.ts` grows (`BundleIdCapabilityResource` gains `settings`; profile-by-bundle-id
  lookup) and a `.mobileprovision` entitlements extractor joins `core/`. Must keep the rules: child
  processes via `core/exec.ts`, secrets only in the keychain, no `any` / needless `as`, JSDoc on
  exports.
- **−** `NEEDS_VALUE` is a deliberate build-breaking sentinel — invalid on purpose so a build fails
  loudly rather than shipping a broken entitlement; a `doctor` / `configCheck` rule for it is a clean
  follow-up.

## Implementation phases (smallest-first, each its own PR + tests, gate green between)

1. **Skeleton:** `core/adopt/` — `Adopter` interface + shapes (in/imported from `core/types.ts`),
   `registry.ts`, `orchestrator.ts` (shared plan→confirm→write reusing `sync`'s `act` / `ActionLog`);
   `cli/commands/adopt.ts` wiring (`--all` / `--app` / `--dry-run` / `--yes`).
2. **products adopter** (highest fidelity, biggest hand-authoring win) + fresh-vs-existing
   `launch.config.ts` writer extending `init`.
3. **capabilities adopter:** curated `CAPABILITY_TYPE → entitlement key` reverse map in
   `capabilities.ts` (single source of truth); `.mobileprovision` extractor (`security cms -D` +
   `plutil`); `BundleIdCapabilityResource.settings` + `/merchantIds`; `app.json` static-patch /
   dynamic-print.
4. **certs adopter:** detect + verdict, delegate to `credentials.ts`, profile download+install.
5. **listing adopter** (delegate to `metadata pull`) + **wizard / `firstRun` detection offer**.

Per the conventions: domain shapes in `types.ts` (ASC wire types in `ascClient.ts`), core adopter + CLI
command + `*.test.ts` beside the code (each adopter unit-tested against a hand-rolled fake ASC slice,
mirroring `ascSync`'s `AscCatalogApi`), and
`npm run typecheck && npm run lint && npm run test && npm run build` + `format:check` green before done.
