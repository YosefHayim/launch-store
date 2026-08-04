# ADR 0001 - Store CRUD parity: close the Apple gap tail + full Google Play CRUD

- **Status:** Accepted - largely implemented (2026-07-19 audit). Apple slices A1-A4 and Google catalog /
  reviews / tracks land under `src/core/store/*`, matching CLI commands (`availability`, `customPages`,
  `accessibility`, `playProducts`, `playSubscriptions`, `playTracks`, `playReviews`, ...). Residual work is
  ordinary product backlog, not design sign-off.
- **Supersedes:** archived `docs/archive/plan-android.md` decision 7 (partial - see below)
- **Context:** converged in a `/grill-me` session; this ADR is the decision record, the GitHub epics
  (Apple tail + Google parity) are the per-slice PRD.

## Context

Launch's App Store Connect coverage is already deep - ~150 client methods across 12 domains, with
wire types auto-generated from Apple's OpenAPI spec into `src/apple/generated/schema.ts`. So the remaining
Apple work is a **tail of specific manual portal steps**, not a frontier.

Google Play today is **reads-only by design** (`plan-android.md` decision 7): `playClient.ts` reads
`versionCode` / track status, `submit/googlePlay.ts` uploads the `.aab` via fastlane `supply`, and
`launch metadata` syncs the listing **text** via `supply` + a shared `store.config.json`
(images/screenshots/changelogs are explicitly skipped). The product catalog, reviews, and track
lifecycle have **no Google path at all**.

**Goal (locked):** only build what removes a *concrete* manual step a user still makes in the Apple
Developer portal / Xcode / Play Console. Coverage-for-its-own-sake is rejected per YAGNI.

## Decision

### Apple - close the gap tail (4 slices)

Hand-written, each against its nearest existing sibling; wire types already exist in `schema.ts`, so
**no generator** (it would emit correct boilerplate for ~1 of 4 and can't write the bespoke
reconcilers).

| Slice | Family | Kills the manual step |
| ----- | ------ | --------------------- |
| **A1** | `betaBuildLocalizations` + `betaAppReviewSubmissions` | "What to Test" notes + Beta App Review on every external TestFlight build |
| **A2** | `appAvailabilities` (v2 createRequest) + `territoryAvailabilities` | Choosing which countries the app sells in |
| **A3** | `appCustomProductPages` (+versions/locales) + `appStoreVersionExperiments` v2 (+treatments/locales) | Custom product pages + product-page A/B testing |
| **A4** | `accessibilityDeclarations` | Apple's 2025 accessibility compliance answers (open attribute-map; age-rating clone) |

### Google - full CRUD on the Android Publisher product surface (architecture)

The `androidpublisher` OAuth scope already requested covers the **entire** API (edits, monetization,
reviews); the transactional **edit lifecycle** (`createEdit`/`deleteEdit`/`request`) already exists in
`playClient.ts`. So parity needs **no new auth and no new transport** - only new methods, reconcilers,
and commands.

The integration splits exactly as iOS already does:

- **Listing text + images -> fastlane `supply` via `store.config.json`.** Text is already shipped;
  extend it to **stop skipping images/screenshots/changelogs**. `supply` keeps owning the binary's
  resumable upload (decision 7's rationale still holds *here*).
- **Catalog / reviews / track lifecycle -> native `playClient` writes**, mirroring how iOS drives
  `sync` / `offers` / `reviews` / `release` through `ascClient` (not `deliver`/`supply`):
  `inappproducts`, `monetization.subscriptions` (base plans + offers), `reviews` (list + reply),
  `edits.tracks` (promote / halt / rollout / per-track release notes), `edits.testers`,
  `edits.countryavailability`.

**Catalog config:** reuse the existing `AppProducts` / `SubscriptionConfig` common fields (product id,
localizations, trial, price) and add Google-specifics (base plans, offer tags, regional price) under a
nested **`play:` override** - DRY for the ~80% overlap, honest about Apple-groups vs Google-base-plans
divergence. Mirrors the `store.config.json` `apple` / `android` precedent.

## Supersedes

`plan-android.md` decision 7 said "hand-rolled `GooglePlayClient` for **reads only**." This ADR
reverses that **for catalog, reviews, and track lifecycle** - those gain native writes. Binary upload
and listing text/images stay on `supply`. `plan-android.md` decision 7 is updated to point here in the
first build PR.

## Out of scope - structurally absent, not deferred

- **Apple irreducible** (no API exists): create the app *record*, create sandbox testers,
  Agreements/Tax/Banking, accepting the Program License Agreement, App Clip *binary* creation. Launch
  can only **detect + deep-link**, never automate.
- **Google no-equivalent**: signing certs / profiles / devices (Play App Signing is Google-managed),
  App Clips (Instant Apps), Game Center (Play Games Services - *separate* API), Wallet / Apple Pay ids
  (Google Wallet - *separate* API), EU alternative distribution (no equivalent), team management (Play
  Console only). **Reports** map to the Play Developer **Reporting API** (a separate API) - future, not
  this effort.

## Consequences

- **+** One CLI with real CRUD on both stores for the product surface that actually forces browser
  trips today.
- **+** No leaky cross-store abstraction; store divergence is isolated to `play:` overrides.
- **-** `playClient.ts` grows from a ~250-line reader into a real write client (edit transactions,
  monetization, reviews). It must keep the same rules as `ascClient`: all child processes via
  `core/exec.ts`, secrets only in the `SecretStore`, no `any`/needless `as`, JSDoc on exports.
- **-** Reverses a documented decision (acceptable - `plan-android.md` is updated alongside).

## Implementation phases (smallest-first, each slice its own PR + tests, gate green between)

1. **Apple cheap/high-frequency:** A4 accessibility -> A1 what-to-test + beta review.
2. **Apple heavier:** A2 territories -> A3 custom pages + experiments.
3. **Google foundation:** `playClient` write-lifecycle + listings images (B1).
4. **Google catalog:** B2 in-app products -> B3 subscriptions + offers (shared config + `play:`).
5. **Google rest:** B4 reviews -> B5 tracks / releases / testers / country availability.

Per the conventions: domain shapes in `types.ts` (ASC wire types in `ascClient.ts`, Play wire types in
`playClient.ts`), core reconciler + CLI command + `*.test.ts` beside the code, and
`pnpm typecheck && pnpm lint && pnpm test && pnpm build` + `format:check` green before done.
