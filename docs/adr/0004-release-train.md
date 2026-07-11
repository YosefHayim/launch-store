# ADR 0004 — `launch release-train`: cross-store coordinated release

- **Status:** Accepted — signed off 2026-06-15 (`/grill-me`).
- **Context:** this is **axis 2** of the four converged differentiation axes (GitOps ·
  **cross-store coordinated release** · AI listing authoring · local insights). It rides the substrate
  ADR 0003 established and ships **in the same PR** as the ADR 0003 v1.1 breadth work.

## Context

Today a real release is several separate, manually-sequenced commands per platform: `launch build`,
`launch release ios|android`, `launch status --watch`, `launch rollout`, and `launch update` for OTA.
Each is solid on its own, but **nothing coordinates them**. The release engineer is the orchestrator —
watching two review queues with different latencies, remembering to release each store, and hand-timing
the OTA so it doesn't land before its native build is live.

The three release surfaces have **fundamentally different primitives and latencies**:

- **iOS** (`core/appStoreRelease.ts`): submit-for-review → approve (hours–days) → release
  (immediate / manual / scheduled) → optional 7-day **phased %** rollout, steerable via `rollout`.
- **Android** (the Play submitter): promote the artifact to the production **track** with a **staged %**
  rollout.
- **OTA** (`core/otaManifest.ts` + storage): publish a JS bundle keyed `channel/platform/runtimeVersion`.

EAS has `build` + `submit` + `update` as independent steps with no coordinator; fastlane leaves
sequencing to the user's Fastfile. A single command that coordinates build → submit → release → OTA
across both stores, survives a multi-day review, and is safe under partial failure is a gap neither
closes.

**Goal (locked):** one command that drives an app's whole release across iOS + Android + OTA, with a
unified, resumable, CI-gradable view — by **orchestrating the existing core primitives**, not
reimplementing release logic.

## Decision

Add `launch release-train` — a small state machine over the existing release primitives. Each platform
(+ OTA) is a **car**; the **train** is one app's coordinated release.

### D1. Semantics — coordinated submit, **release-when-ready**, optional sync gate

Build + submit every car together, then **each car releases on its own approval** (release-when-ready).
An opt-in **`--hold`** gate (hold-until-all-approved) gives teams that want a lockstep launch one
synchronized release moment. The train **orchestrates core primitives** (`appStoreRelease`, the Play
submitter, the OTA publish core) the same way `plan` calls `reconcileApp` rather than shelling out to
`launch sync` — the CLI commands stay thin; release logic is not duplicated.

### D2. Membership — per-app, cars resolved from config, flags override

A train coordinates **one app** (or `-a <app>`). Its cars are resolved from config: **iOS** if a bundle
id is declared, **Android** if a package is declared, **OTA** if a channel is configured — every car by
default. Flags scope it: `--platform ios|android`, `--no-ota`. (Repo-wide multi-app trains are out of
scope — the state/blocking matrix balloons; YAGNI.)

### D3. Process model — reconcile-driven persistent record (no daemon)

A train outlives a single process (review takes days), and the repo avoids long-running daemons. So a
train is a **persistent record** advanced by reconcile, mirroring `~/.launch/build-state/`:

- `release-train start` — writes `~/.launch/release-trains/<id>.json` and kicks each car's build + submit.
- `release-train status [<id>] [--watch] [--json]` — the **engine**: reads live store state, advances
  any car whose gate has opened (fires its release, respects `--hold`), persists, and reports. `--watch`
  is a live foreground view over the record; CI runs `status --json` on a cron.

Accepted tradeoff: a release fires at the **next `status` invocation**, not the literal instant of
approval — CI cron (or `--watch`) closes the gap. No background process, fully resumable, same `0/2/3/1`
exit-code spirit as `launch status`.

### D4. OTA gating — per-platform

The OTA car for `(platform, runtimeVersion)` publishes as soon as **that platform's native build
carrying that runtime version is live in its store** — iOS OTA on iOS release, Android OTA on Android
release, independently. This matches the per-platform OTA layout and release-when-ready; it never pushes
JS for a runtime version users don't have yet.

### D5. Partial failure — never auto-undo; reject ⇒ `blocked`

The train performs **no destructive action automatically** (consistent with the repo's
no-destructive-without-consent DNA). A rejection or failure marks **that car** failed:

- Under `--hold`, the train enters a **`blocked`** state requiring an explicit operator decision.
- Already-live cars are **never** auto-rolled-back; OTA is **never** auto-reverted. Rollbacks stay
  explicit (`launch rollout pause`, `launch updates rollback`).
- Recovery after fixing + re-submitting the failed platform is implicit: the next `status` reconcile
  sees it back in review and the train resumes holding/advancing.

### D6. Verbs — `start` / `status` / `release` / `abort`

| Verb | Behavior |
| --- | --- |
| `release-train start [-a <app>] [--platform <p>] [--no-ota] [--hold]` | Create the record; kick builds + submits for each car. |
| `release-train status [<id>] [--watch] [--json]` | Reconcile the train forward; advance + persist + report. The workhorse. |
| `release-train release [<id>]` | Resolve a `blocked` train — release the ready/approved cars now (override the `--hold` gate), leaving the failed car tracked. |
| `release-train abort [<id>]` | Stop the train. Never un-releases a live car; marks the record terminated. |

`resume`/`cancel` are intentionally omitted — they collapse into reconcile + re-submit. Mirrors the
`rollout <action>` verb style.

### Car state machine (per car, persisted on the record)

```
building → submitted → in-review → approved → released
                          │            │
                          └─ rejected ─┴──────────────→ failed
OTA car:  pending → (native released) → published
Train:    running → (─-hold + a rejection) → blocked → done | aborted
```

### Architecture

```
src/core/releaseTrain/types.ts        // TrainRecord, Car, CarState, TrainState  (mirrors plan/types.ts)
src/core/releaseTrain/record.ts       // read/write ~/.launch/release-trains/<id>.json  (mirrors lastRun.ts)
src/core/releaseTrain/orchestrator.ts // start() kicks cars; advance(ctx) reconciles + fires gated steps
src/cli/commands/releaseTrain.ts      // thin: start | status | release | abort
```

The orchestrator calls the **core** release primitives directly: `core/appStoreRelease.ts` (iOS), the
Play submitter provider (Android), and the OTA publish path (`core/otaManifest.ts` + the active
`StorageProvider`). The one extraction this requires: lift the OTA publish body out of
`cli/commands/update.ts` into a reusable `core` function the command and the train both call
(behavior-preserving, guarded by the existing update tests).

## Out of scope — deferred

- **Repo-wide multi-app trains** (D2) — one app per train in v1.
- **Autonomous daemon** firing on approval without re-invocation (D3) — CI cron is the v1 answer.
- **Auto-rollback / atomic all-or-nothing release** (D5) — deliberately rejected; rollbacks stay
  explicit.
- **Scheduled / phased coordination beyond the existing `ReleaseConfig`** — the train reuses each
  car's existing release type; it does not add new scheduling primitives.

## Consequences

- **+** One command drives an app's whole cross-store release with a resumable, CI-gradable record —
  the "release command center" EAS/fastlane don't offer.
- **+** Pure orchestration: no duplicated release logic, reuses `appStoreRelease` / the Play submitter /
  the OTA core, and the `~/.launch` record + reconcile patterns already in the repo.
- **+** Safe by construction — no automatic destructive action; `blocked` forces a human decision.
- **−** Requires lifting OTA publish into `core` (behavior-preserving refactor, existing tests guard it).
- **−** A new persisted shape (`TrainRecord`) and a new `--json` surface for CI/agents to learn.
- **−** "Release-when-ready" is invocation-driven, not instantaneous — acceptable with cron/`--watch`,
  documented.

## Implementation phases (within the one PR, gate green between commits)

1. **Record + types:** `core/releaseTrain/{types,record}.ts` + tests (round-trip the record).
2. **OTA core extraction:** lift publish out of `cli/commands/update.ts` into `core`; `update` calls it
   (behavior-preserving, existing tests stay green).
3. **Orchestrator:** `start()` (kick builds+submits) + `advance()` (reconcile, gate, fire, persist),
   including `--hold` and the `blocked` transition; unit-tested against fake ASC/Play/storage APIs with a
   **no-auto-undo** spy assertion (mirrors ADR 0003's read-only spy).
4. **CLI:** `cli/commands/releaseTrain.ts` — `start | status | release | abort`, `--watch`/`--json`.
5. **Polish:** `release-train` glossary topics for `--explain` (⚠️ bump the `glossary.test.ts`
   `toBe(N)` count — known merge hotspot) and `npm run docs:gen`.

Conventions hold: child processes via `core/exec.ts`, secrets only in the keychain, no `any`/needless
`as`, JSDoc on exports, and `npm run typecheck && npm run lint && npm run test && npm run build` +
`format:check` + `npm run docs:check` green before done.
