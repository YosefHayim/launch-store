# ADR 0005 — `launch compliance`: Compliance Autopilot (generate legal docs + store declarations from real capabilities)

- **Status:** Proposed — designed 2026-06-22 (`/grill-me`). **Not built** (2026-07-19 audit): no
  `src/core/compliance/`, no `launch compliance` command. Substrate exists only as partial inputs
  (`src/core/privacy/*`, readiness probes for age rating / export compliance / listing URLs, store
  export-compliance helpers). Do not treat privacy reconcile as this ADR shipping.
- **Context:** this ADR records the converged design so it survives across sessions.
- **Context:** a fifth differentiation axis beyond the four in ADR 0003/0004 (GitOps plan/drift ·
  cross-store release · AI listing · local insights): **fear-removal nobody else can do.** It reuses the
  substrate those ADRs established (the readiness-probe and `SurfacePlanner` registries, the `*.config.json`
  seam, the privacy reconcile engine) rather than introducing a new spine.

## Context

Every app must ship a **privacy policy**, answer Apple's **App Privacy** "nutrition label" + Google
**Play Data Safety**, set an **age rating**, declare **export compliance**, and — in several regimes —
provide **Terms of Service / EULA**. These are opaque, drift every time an SDK or permission is added,
and are a top source of rejection and anxiety, especially for solo developers and "vibe coders" who fake
a privacy policy with a generic generator and guess at the questionnaires.

fastlane and EAS offer **nothing** here. The unique, defensible angle: derive what the stores require
from the app's **real capabilities** — its declared permissions **and its SDK dependency tree** (Firebase,
Sentry, AdMob, RevenueCat collect data with *zero* permission footprint, so a permission-only view misses
them) — fitted to the **territories** the app ships in. No open-source or vendor tool derives compliance
from the dependency tree.

Launch already holds ~70% of the inputs: `core/privacy` parses the privacy surface (permissions, iOS
manifest, Android permissions) and reconciles it; `availability` models the App Store territories;
`core/exportCompliance` and the `ageRatingDeclaration` ASC resource are handled; `core/packageManager`
detects the lockfile/manager. What is missing is the **SDK→data layer**, a **clause library**,
**jurisdiction rules**, and the **generators** — and those are the moat.

**Business-model constraint (locked):** Launch is "your machine, your keys, no bill." So Compliance
Autopilot is **free forever, fully local, offline, no backend/control plane** — funded by sponsors. The
ethos extends to the business model itself (the Vite/esbuild/fastlane-pre-acquisition posture).

**Goal (locked):** one local command that reads real capabilities + territories and **generates** the
privacy policy, ToS/EULA, and every structured store declaration — by **composing the existing privacy /
availability / export / age-rating primitives** plus a curated, in-package dataset, never a server or an
AI API.

## Decision

Add a `launch compliance` group that reads capabilities + territories and **generates** the artifacts via
**deterministic templates + a curated clause library** (no AI).

### D1. Generation — deterministic templates + curated clause library (no AI)

The output is assembled from maintained templates and a curated clause library, not a model. Rationale:
**legally safer** (no hallucinated clauses), **fully traceable** (every clause maps to a capability +
jurisdiction), **offline**, **no API key**, **deterministic** (re-runs are byte-stable). The
"intelligence" is a *dataset shipped inside the package* — the `caniuse-lite` model.

### D2. v1 artifacts — all four families (maximalist)

① privacy policy document; ② Apple **App Privacy** + Google **Play Data Safety** answers; ③ **ToS/EULA**;
④ **age-rating** + **export-compliance** derivation. The shared dataset feeds every family, so the
marginal cost of each after the first is small.

### D3. Command home — new `launch compliance` group

`launch compliance generate` (produce artifacts; flags select a subset) + `launch compliance check` (the
gap analysis). It **reuses `core/privacy/reconcile.ts`** as the check engine (extends the seed maps in
place, does not fork); `launch privacy scan` becomes a **back-compat alias**. New generation logic lives
in a fresh `src/core/compliance/`. The name "privacy" undersold ToS/EULA/age/export — hence the group.

### D4. Dataset — in-package typed TS modules, npm-release freshness

The SDK→data-category map, the clause library (keyed **data-category × jurisdiction**), and the
jurisdiction rules ship as **typed TS modules** under `src/core/compliance/data/` (matching the existing
inline-TS-const precedent; no JSON, so no "strict-JSON can't comment" problem). Freshness = a normal
`launch-store` npm release (**not** `launch update`, which is OTA). A **coverage test** pins the dataset
against rot (like the `glossary.test.ts` `toBe(N)` count); PRs adding SDK entries make the moat
**community-maintained** — the sponsor/MIT model working *for* the project.

### D5. Jurisdictions — tier-1 four

GDPR (EU/EEA + UK), CCPA/CPRA (California), COPPA (age-gated), EU **DSA trader** (net-new — `eu-distribution`
is **DMA**, not DSA). Triggered from the `availability` territory list + the age rating. The long tail
(US state laws, LGPD, PIPEDA, PIPL) grows via community PRs — explicitly **not** boiled in v1.

### D6. Human input — `compliance.config.json` + first-run wizard

The underivable legal/business facts (legal entity, contact, data-retention, sells/shares-data?, effective
date, children-directed) live in a dedicated **`compliance.config.json`** (per-domain `*.config.json`
convention), scaffolded by a first-run **`@clack` wizard**; `--yes`/flags keep it non-interactive for CI
and agents. Everything **technical** (SDK tree, permissions, territories, age rating) is **derived, never
asked**.

### D7. Integration — full (probe + SurfacePlanner)

Register a **readiness probe** (`core/readiness/registry.ts` → gates in `audit` / `store doctor`) **and** a
**`SurfacePlanner`** (`core/plan/registry.ts` → `plan` / `drift`). This delivers the compliance-as-code
**drift loop**: add `firebase-analytics` → `drift` flags the generated policy/answers as stale → `compliance
generate` regenerates → `audit` goes green. One register line each.

### D8. SDK depth — hybrid (resolved set ∩ map)

Read the flat **set** of installed packages from the lockfile (reusing `core/packageManager.ts` detection),
**intersect** with the curated SDK→data map, and surface **only known collectors** (no noise from the
hundreds of irrelevant utility packages). Fall back to `package.json` deps + Expo config plugins when no
lockfile is present. Only the name-set is needed, not the dependency graph.

### D9. Output — hybrid (docs to a dir, declarations to config)

Human-facing docs (privacy policy / ToS / EULA) → a `compliance/` output dir as `.md` + `.html` (host
anywhere). Structured declarations → the config files their consumers already read — Play Data Safety into
`play-content.config.json`, App Privacy answers into a file the #52 checklist surfaces. Each artifact lands
where its consumer expects, maximizing drift detection + the (limited) push path.

## Hard external constraints (bound what "autopilot" can apply)

- **Apple App Privacy is UI-only** (#52) — no ASC API. Launch *generates* the answers; the developer
  pastes them. No programmatic apply, no diff-against-published.
- **Play Data Safety is write-only** — only a CSV POST (`applications.dataSafety`); **no read API**. So a
  Play "App Content" reconcile (issue #227) is reducible to a thin write-only push, and the **drift loop
  diffs code/config vs the last-generated artifacts, not vs published store state** — which is exactly how
  `privacy scan` already frames its limits.

## Architecture

```
src/core/compliance/data/sdkDataMap.ts      // npm package → data categories collected (the moat)
src/core/compliance/data/clauseLibrary.ts   // data-category × jurisdiction → clause text
src/core/compliance/data/jurisdictions.ts   // territory / age → applicable regimes
src/core/compliance/types.ts                // ComplianceConfig + generated-artifact shapes
src/core/compliance/generate.ts             // deterministic generators (policy, ToS, declarations)
src/core/compliance/check.ts                // reuse privacy reconcile + SDK-derived gaps
src/core/compliance/probe.ts                // readiness probe (registered in readiness/registry.ts)
src/core/compliance/planner.ts              // SurfacePlanner (registered in plan/registry.ts)
src/cli/commands/compliance.ts              // thin: generate | check  (+ privacy scan alias)
```

Reuses (does not fork): `core/privacy/reconcile.ts`, `core/packageManager.ts`, `core/exportCompliance.ts`,
the `ageRatingDeclaration` ASC resource, `core/privacyNutritionLabel.ts`, `@clack/prompts`, and the
readiness + `SurfacePlanner` registries.

## Out of scope — deferred

- **Long-tail jurisdictions** (US state laws, LGPD, PIPEDA, PIPL) — community PRs, not v1.
- **Drift vs published store state** — impossible (App Privacy unreadable, Data Safety write-only).
- **Hosting the privacy policy** — Launch emits the file; the developer hosts it (no server, by design).
- **Deep ToS customization** beyond the templated clauses — v1.1.

## Consequences

- **+** A unique "fear-removal" moat — SDK-derived compliance no competitor offers — that fits the
  free/local/no-bill ethos and is funded by sponsors, not a control plane.
- **+** Mostly composition: reuses existing privacy/availability/export/age-rating inputs and the two
  registries; v1 is the dataset + generators + a thin command + two register lines. No new dependency.
- **+** Deterministic + offline + traceable; legally safer than AI generation.
- **−** A real **curation burden** (the dataset *is* the moat) — mitigated by the coverage test + the
  community-PR maintenance model.
- **−** Apply-side limits the product can't remove: App Privacy is paste-only, Play Data Safety is
  write-only/no-read — must be communicated honestly in output + docs.

## Implementation phases (when authorized; gate green between commits)

1. **Dataset:** `core/compliance/data/*` + a coverage test pinning shape/coverage.
2. **Generators:** `generate.ts` for the four artifact families (pure, unit-tested byte-stable output).
3. **Config + wizard:** `compliance.config.json` types + the first-run `@clack` scaffold (`--yes` path).
4. **Check + probe:** extend `privacy/reconcile.ts` with SDK-derived gaps; register the readiness probe.
5. **Planner:** register the `SurfacePlanner` (drift vs last-generated artifacts).
6. **CLI + docs:** `cli/commands/compliance.ts` (`generate | check`), the `privacy scan` alias, glossary
   topics for `--explain` (bump the `glossary.test.ts` `toBe(N)` count — known merge hotspot), `docs:gen`.

Conventions hold: child processes via `core/exec.ts`, secrets only in the keychain, no `any`/needless `as`,
JSDoc on exports, and `npm run typecheck && npm run lint && npm run test && npm run build` + `format:check`
+ `npm run docs:check` green before done.
