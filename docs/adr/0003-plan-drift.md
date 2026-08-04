# ADR 0003 - `launch plan` / `launch drift`: store-config-as-code diff & drift detection

- **Status:** Accepted - v1 (4 surfaces) shipped; **v1.1 breadth** signed off 2026-06-15 (see
  [Amendment](#amendment--v11-breadth-completion-grill-me-2026-06-15)). - 2026-06-15
- **Context:** converged across two `/grill-me` sessions; this ADR is the decision record. The v1.1
  breadth work below and **axis 2** (`launch release-train`, [ADR 0004](./0004-release-train.md)) ship
  together in one PR.

## Context

Launch already makes the whole store presence declarative: 16 reconcilers (`sync`, `offers`,
`release-config`, `game-center`, `wallet`, `app-clips`, `events`, `experiments`, `availability`,
`accessibility`, `eu-distribution`, `play-products`, `play-subscriptions`, plus listing/screenshots)
each compute a **read-only plan -> confirm -> apply** against live store state. But that plan is
**scattered across 16 separate commands** and only ever surfaces as a prelude to *applying*. There is:

- **No single command** that runs every reconciler's dry-run across **both** stores and prints one
  unified diff - you cannot answer "what does my config say vs. what is actually live?" in one shot.
- **No drift detection** - no read-only, CI-gradable check that fails when someone edited pricing,
  a listing, or a capability **in the portal** out from under the config.

This is the one thing **no competitor has**, and it is cheap for us specifically because the two
halves of a diff already exist: every reconciler returns the shared `ReconcileReport` /
`PlannedAction[]` shape (`src/core/store/ascSync.ts`) and `--dry-run` *is* a read-only plan;
`launch adopt` (ADR 0002) already reads live store state.
fastlane's `deliver`/`supply` are one-directional push with no unified typed config; EAS has no
store-config model at all. A Terraform-style `plan`/`drift` loop over the store is a gap none of them
can close without first building what Launch already has.

This is the **first of four** converged differentiation axes (GitOps - cross-store coordinated
release - AI listing authoring - local insights). GitOps is sequenced first because it is both the
moat **and** the substrate the other axes reuse: AI listing authoring becomes *safe* only when its
proposed writes can be previewed as a diff before apply, and cross-store release reuses the same
unified live-state read.

**Goal (locked):** surface the diff Launch already computes as one read-only command across both
stores, plus a CI-gradable drift gate - by **aggregating existing reconcilers**, not by deepening any
single one. No change to the `PlannedAction` type or any reconciler in v1 (YAGNI).

## Decision

Add `launch plan` - a single modal, read-only command; `launch drift` is a thin alias for
`launch plan --check`.

| Invocation | Behavior | Exit |
| --- | --- | --- |
| `launch plan` | Unified read-only diff (config vs live), both stores, all v1 surfaces, all apps | `0` (`1` on error) |
| `launch plan <surface>` | Scope to one surface (`catalog` / `listing` / `play-products` / `play-subscriptions`) | `0` (`1` on error) |
| `launch plan -a <app>` | Scope to one or more apps (mirrors `sync -a`) | `0` (`1` on error) |
| `launch plan --check` / `launch drift` | CI gate, read-only | `0` in sync - `2` drift - `1` error |
| `launch plan --json` | Machine output for agents | as above |

### Diff rendering - reuse existing plan lines as-is

Aggregate each reconciler's existing `ReconcileReport` and render `PlannedAction.description` with a
leading glyph derived from the verb + the `destructive` flag (`+` add - `~` change - `-` destroy),
grouped store -> app -> surface. A surface that emits **zero** actions renders `= in sync` - no new
field needed, because a reconciler only records an action when something differs (exactly how
`sync.ts:331` already shows "already in sync"). `before->after` appears wherever a reconciler already
emits it (listing copy, `ascSync.ts:512`); field-names-only where it does not (release attributes,
`releaseAttrs.ts:231`). **Zero change to `PlannedAction` or any reconciler.** Uniform structured
`field: before -> after` is explicitly a **v2** enrichment (see Out of scope).

### Architecture - a `SurfacePlanner` registry (mirrors the Adopter registry, ADR 0002)

The scope is "every config-as-code surface," so it must be extensible, not a god-function. Define a
`SurfacePlanner` interface and register planners like adopters/providers; the orchestrator walks the
registry, runs each planner's dry-run, aggregates the reports, and maps the result to the exit-code
contract. Adding one of the remaining 12 surfaces later is a new file + one `register()` line - the
orchestrator is never touched (the repo's documented "implement an interface + register it" rule).

```ts
interface SurfacePlanner {
  id: string;                       // 'catalog' | 'listing' | 'play-products' | ...
  store: "appstore" | "play";       // drives credential resolution + grouping
  plan(ctx: PlanContext): Promise<ReconcileReport[]>;  // dry-run only; never writes
}
```

```
src/core/plan/types.ts          // SurfacePlanner + PlanContext + PlanOutcome   (mirrors adopt/types.ts)
src/core/plan/registry.ts       // registerSurfacePlanner / registerBuiltinPlanners
src/core/plan/orchestrator.ts   // runPlanners() -> aggregate, summarize, exit-code map
src/core/plan/planners/{catalog,listing,playProducts,playSubscriptions}.ts
src/cli/commands/plan.ts        // thin command: loadConfig -> runPlanners -> render -> exit
```

To stay DRY, the catalog/listing/Play planners reuse the existing commands' config->input mapping:
`sync.ts`'s private `buildJobs` / `reconcileJob` (and the three siblings' input-builders) are
extracted into shared `core` helpers that **both** the existing command and the planner import - a
behavior-preserving refactor guarded by the existing reconciler tests.

### v1 coverage - the 4 surfaces people change release-to-release

ASC **catalog** (capabilities / IAPs / subscriptions / pricing), ASC **listing/metadata**, Play
**products**, Play **subscriptions** - so the headline "unified diff across **both** stores" lands in
v1. The other 12 surfaces (`offers`, `release-config`, `game-center`, `wallet`, `app-clips`, `events`,
`experiments`, `availability`, `accessibility`, `eu-distribution`, `custom-pages`, screenshots) are
each a ~10-line follow-up planner + `register()`, landed incrementally per YAGNI.

### Exit-code contract - error wins (certify-or-fail)

Plain `launch plan` is **informational**: exit `0` even with pending changes, `1` only on a genuine
error. `launch plan --check` / `launch drift` is the gate: `0` in sync, `2` drift present, `1` error -
and **error takes precedence over drift**. Rationale: if a surface could not be read, the check cannot
honestly certify "no drift," so CI must fix connectivity/creds first (`drift + error -> 1`). Mirrors
the established `launch status` exit-code convention (`0/2/3/1`).

### Credentials across two stores - certify-or-fail, consistent with the contract

- **No config for a store** (e.g. ASC-only project, no Play catalog) -> that store is **silently
  omitted** - nothing declared, nothing to check.
- **Config declared but creds missing** (Play products declared, no Play service account) -> the
  surface is **unreadable**. Plain `launch plan` shows it as a **visible skip** with an actionable
  hint (`run \`launch creds ...\``) at exit `0`; `launch plan --check` treats it as an **error
  (exit 1)** - the gate cannot certify what it could not read. Escape hatch: scope a run with
  `launch plan <surface>` or `-a <app>` to deliberately narrow coverage.

### Invariants (asserted + tested, not optional)

- **Read-only:** every planner calls its reconciler with `dryRun: true`. Unit test: a spy API records
  **zero** write calls across a full plan run.
- **Resilient:** per-surface / per-app error capture (mirrors `sync.ts`'s isolated pool) - one broken
  surface is recorded as an error and never aborts the rest of the sweep.

## Out of scope - deferred, not part of v1

- **Structured `before -> after` on `PlannedAction`** (uniform Terraform-grade field diffs +
  machine-gradable `--json` field deltas) - a v2 enrichment that touches `types.ts` and all 16
  reconcilers; deferred per "no time"/YAGNI. v1 ships the description-line diff, which no competitor
  has at any granularity.
- **The 12 remaining surfaces** - the registry exists for them. **Now scoped:** the v1.1
  [Amendment](#amendment--v11-breadth-completion-grill-me-2026-06-15) wires 9 of them (the 2 imperative
  ones - `events`, `offers codes` - are explicitly excluded as non-drift surfaces).
- **The other three differentiation axes** - cross-store coordinated release (**now**: axis 2,
  [ADR 0004](./0004-release-train.md)), AI listing authoring, local insights - each gets its own
  ADR/epic and rides this substrate.
- **Store snapshot / "time-machine" (`launch plan --out` -> diff/restore against a saved state) and a
  pre-submission compliance audit** - both become nearly free once the unified read exists; noted as
  high-value follow-ups, not v1.

## Consequences

- **+** One read-only command answers "config vs. live, both stores" and gives CI a real drift gate -
  a capability fastlane and EAS structurally cannot match without first building Launch's typed-config
  + live-read pair.
- **+** Turns the risky future "AI rewrites your listing" feature into a safe one: AI proposes ->
  `launch plan` shows the exact diff -> human confirms.
- **+** Reuses the existing reconcilers, `ReconcileReport` shape, and `loadConfig` - little net-new
  surface; the registry keeps the remaining 12 surfaces additive with a stable orchestrator.
- **-** Extracting `sync.ts`'s private `buildJobs`/`reconcileJob` (and three siblings') into shared
  `core` helpers is a behavior-preserving refactor across the v1 command files - guarded by their
  existing tests. Must keep the rules: child processes via `core/exec.ts`, secrets only in the
  keychain, no `any`/needless `as`, JSDoc on exports.
- **-** The description-line diff is intentionally inconsistent in `before->after` detail until the v2
  enrichment; the `= in sync` / glyph summary keeps it legible in the meantime.

## Implementation phases (smallest-first, each its own PR + tests, gate green between)

1. **Skeleton:** `core/plan/` - `SurfacePlanner` interface + shapes (`core/plan/types.ts`),
   `registry.ts`, `orchestrator.ts` (aggregate + summarize + exit-code map); `cli/commands/plan.ts`
   wiring (`plan` + `drift` alias, `--check` / `--json` / `<surface>` / `-a`). Land with **one** wired
   planner (catalog) end to end so the command is real.
2. **Catalog planner:** extract `sync.ts`'s `buildJobs`/`reconcileJob` into a shared `core` helper the
   command and planner both import; render + summary + certify-or-fail skip handling.
3. **Listing planner:** wire the listing/metadata reconcile dry-run (reuse `sync`'s listing path).
4. **Play planners:** `play-products` + `play-subscriptions` - delivers the cross-store headline; Play
   credential resolution + missing-creds skip/error behavior.
5. **Polish:** `plan`/`drift` glossary topics for `--explain` ([WARN] bump the `glossary.test.ts`
   `toBe(N)` count - known merge hotspot), `launch plan --json` schema doc, and `pnpm docs:gen`
   (new command -> `docs/commands.md` + `llms*.txt` drift gate).

Per the conventions: domain shapes in `core/plan/types.ts` (mirroring `adopt/types.ts`), core
orchestrator + planners + CLI command + `*.test.ts` beside the code (`plan.test.ts` covers
aggregation, exit-code mapping, certify-or-fail, and the read-only spy assertion; planners unit-tested
against the existing reconciler fakes), and
`pnpm typecheck && pnpm lint && pnpm test && pnpm build` + `format:check` +
`pnpm docs:check` green before done.

---

## Amendment - v1.1 breadth completion (`/grill-me`, 2026-06-15)

**Status of v1:** shipped. The `SurfacePlanner` registry, orchestrator, exit-code contract, `--json`,
and the 4 headline planners (`catalog`, `listing`, `play-products`, `play-subscriptions`) are live.
This amendment records the **breadth** decisions that take `plan`/`drift` from 4 surfaces to honest
coverage of the declared store presence. It changes nothing already shipped; it only adds planners and
two small, additive shapes in the **plan layer** (never `PlannedAction`, never a reconciler - the v1
goal holds).

### A1. Breadth before depth (decided)

The next increment is **coverage**, not precision: wire the remaining declarative surfaces. Uniform
structured `field: before -> after` (v2) stays deferred - a wide, honest diff beats a narrow, precise
one for the GitOps moat.

### A2. The v1.1 surface list - 9 surfaces, 2 explicit exclusions

| Surface | Config source | Direction |
| --- | --- | --- |
| `release-config` | inline `LaunchConfig.release` | two-way (update detection) |
| `availability` | sidecar `availability.config.json` | two-way (flags territory removals destructive) |
| `game-center` | inline `LaunchConfig.gameCenter` (per-app) | **additive** |
| `app-clips` | inline `LaunchConfig.appClips` (per-app) | **additive** |
| `accessibility` | sidecar `accessibility.config.json` | **additive** |
| `experiments` | sidecar `experiments.config.json` | **additive** |
| `custom-pages` | sidecar `custom-pages.config.json` | two-way (re-reads live) |
| `wallet` | inline `LaunchConfig.wallet` (**team-level**) | **additive** |
| `eu-distribution` | inline `LaunchConfig.euDistribution` (**team-level**) | **additive** |

**Excluded as imperative (not drift surfaces):** `events` (create/localize/delete by id) and
`offers codes`/`deactivate` (one-shot actions). Declarative subscription-offers already ride inside
the `catalog` / `play-subscriptions` planners. All 9 are App-Store-side, so every new planner resolves
through the existing `ctx.resolveAscApi()` - **no new credential path**. Each reconciler already
exposes `reconcileX(api, input): Promise<ReconcileReport>`, so each planner is the same thin wrapper as
`catalog`.

### A3. Additive surfaces - wired **and annotated one-way** (the honesty decision)

Six surfaces (`game-center`, `app-clips`, `accessibility`, `experiments`, `wallet`, `eu-distribution`)
are documented as **additive** reconcilers - they ensure declared items exist but never delete, so they
detect `config -> live` gaps and are **blind to portal-side additions**. Wiring them naively would make
`drift` report "in sync" when it cannot actually see a teammate's portal-side change - false
confidence in a CI gate.

Decision: **wire them, but label them.** Add a `direction: "two-way" | "additive"` field to the
planner (and surface it on the rendered plan + `--json`). The renderer prints additive surfaces with an
explicit *"additive - does not detect portal-side additions"* note. The `drift` gate's guarantee for
an additive surface is therefore **"config is fully applied,"** not "live == config." Genuine
bidirectional drift (list-live -> flag-undeclared-extras) for these surfaces is the **v2 depth pass** -
it would touch the reconcilers and is explicitly out of scope here, preserving the v1 "no reconciler
changes" promise.

### A4. Sidecar config paths - centralized in `launch.config.ts` (DRY)

The four sidecar surfaces (`availability`, `accessibility`, `experiments`, `custom-pages`) read desired
state from a `--config <path>` file that today defaults to a hard-coded filename per command. So `plan`
can't know where they live without a convention. Decision: add an **optional** `configFiles` map to
`LaunchConfig`:

```ts
// LaunchConfig (additive, backward-compatible)
configFiles?: {
  availability?: string;
  accessibility?: string;
  experiments?: string;
  customPages?: string;
};
```

A shared `resolveSurfaceConfigPath(config, surface, flag?)` helper (precedence: explicit `--config`
flag -> `config.configFiles[surface]` -> default filename) becomes the **single source of truth** that
**both** the existing command and the new planner import. Absent file ⇒ the surface is `omitted`
(mirrors `catalog`'s empty-`buildJobs` behavior).

### A5. Team-level surfaces - a `scope: "team"` plan variant

`wallet` and `eu-distribution` reconcile **team-level** resources (no bundle id), which the current
`SurfacePlan` (`apps: AppPlan[]`) can't model. Decision: extend the `SurfacePlan` discriminated union
with a planned **team variant** carrying `actions: PlannedAction[]` directly (no `apps` array):

```ts
| { surface: string; store: PlanStore; state: "planned"; scope: "team"; actions: PlannedAction[]; direction: PlanDirection }
```

The renderer groups these as store -> **Team** -> surface. This is a new shape `--json` consumers (CI /
agents) must handle - called out here and in the `--json` schema doc.

### A6. Definition of done - per-surface drift proof, not just wrappers

Each new planner ships with one focused test (the reconciler fakes already exist, so this is cheap):

1. seed the fake API with a divergence -> assert the expected `PlannedAction`(s) surface;
2. seed an aligned state -> assert the surface renders `= in sync`;
3. for additive surfaces -> assert the one-way annotation renders (so the caveat can't silently
   regress).

Plus: `plan`/`drift` glossary topics for each surface's `--explain` ([WARN] bump the `glossary.test.ts`
`toBe(N)` count - known merge hotspot), and `pnpm docs:gen` to refresh `docs/commands.md` +
`llms*.txt` + the `--json` schema doc.

### A7. Proof rides with breadth (credibility, not a separate milestone)

To avoid widening the "claimed vs proven" gap, the breadth increment ships **with** its proof:

- **Extend the existing `examples/hello-world/`** (its `launch.config.ts` + `store.config.json`) into a
  full-surface example: IAP + subscriptions + the 4 sidecar configs (`availability` / `accessibility` /
  `experiments` / `custom-pages`) + the `configFiles` map + an OTA channel + Play config. This single
  in-repo example **is** the fixture the per-surface drift tests load (with recorded fake API
  responses) - no live store presence required, and it doubles as the adoptable reference. A new
  `examples/` app is **not** added (KISS - extend, don't invent).
- a short **demo** (asciinema/GIF) of `plan` showing real drift, recorded against a real app (not
  committed);
- a precise **"plan coverage / implemented-vs-planned"** note in the README stating which surfaces are
  two-way vs additive - so the "GitOps" claim is provably scoped, not overstated.

(The full README-honesty pass across every feature stays a separate backlog item.)
