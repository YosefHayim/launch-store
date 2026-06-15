/**
 * Shared vocabulary for `launch plan` / `launch drift` — the read-only diff of `launch.config.ts`
 * against live store state (see `docs/adr/0003-plan-drift.md`).
 *
 * Where `core/ascSync.ts` *applies* a per-app reconcile and `core/adopt` *imports* live state into
 * config, plan only *reports*: it runs every registered {@link SurfacePlanner} in dry-run and aggregates
 * the diff each already computes. A planner owns one config-as-code surface (the ASC product catalog,
 * the App Store listing, Play products, …) across every app; the orchestrator never names a concrete
 * surface, so adding one is a new file + one `registerSurfacePlanner()` line — exactly the "implement an
 * interface + register it" seam the provider and adopter registries use.
 *
 * These types describe the *plan mechanism*, not a config shape, so they live here rather than in
 * `core/types.ts` — the same reason `ascSync.ts` keeps `AscCatalogApi`/`PlannedAction` local.
 */

import type { AppDescriptor, LaunchConfig } from "../types.js";
import type { AscCatalogApi, PlannedAction } from "../ascSync.js";

/** Which store a surface belongs to — drives credential resolution and how the diff is grouped. */
export type PlanStore = "appstore" | "play";

/**
 * One app's slice of a surface's plan. `actions` is the reconciler's existing {@link PlannedAction} list
 * (all `planned` in dry-run, with advisory `skipped` lines for length-limit/precondition notes); empty
 * means in sync. `error` is set instead when the app couldn't be planned at all — a precondition the
 * user must fix, e.g. no App Store Connect app record — so the gate never silently certifies it as clean.
 */
export interface AppPlan {
  /** App handle as discovered (used for grouping and the `-a` selector). */
  app: string;
  /** The app's identifier on this store — iOS bundle id / Android package name. */
  identifier: string;
  /** Planned (and advisory-skipped) actions for this app; empty means in sync. */
  actions: PlannedAction[];
  /** Set when this app's reconcile threw a precondition; mutually exclusive with real `actions`. */
  error?: string;
}

/**
 * The outcome of running one surface's planner, as a discriminated union on `state`:
 * - `omitted` — nothing declared for this surface (e.g. no products at all); dropped from output and
 *   exit codes, so an ASC-only project never sees empty Play noise.
 * - `skipped` — declared but unreadable (credentials missing). Benign for plain `launch plan` (a visible
 *   skip at exit 0); a hard error for `launch plan --check`, which cannot certify what it could not read.
 * - `planned` — read successfully; `apps` carries the per-app diff.
 */
export type SurfacePlan =
  | { surface: string; store: PlanStore; state: "omitted" }
  | { surface: string; store: PlanStore; state: "skipped"; reason: string; hint?: string }
  | { surface: string; store: PlanStore; state: "planned"; apps: AppPlan[] };

/**
 * What a {@link SurfacePlanner} is handed: the loaded config, the apps to consider (already narrowed by
 * `-a`), and lazy store-client resolvers. A resolver returns `null` when the account isn't configured,
 * letting the planner emit a `skipped` surface rather than throw. Resolvers are memoized by the command,
 * so several planners over the same store share one client (and one credential read).
 */
export interface PlanContext {
  config: LaunchConfig;
  apps: AppDescriptor[];
  /** Resolve the read-only App Store Connect catalog client, or `null` when no Apple account is active. */
  resolveAscApi(): Promise<AscCatalogApi | null>;
}

/**
 * One config-as-code surface's planner. {@link plan} is **read-only**: it resolves live state and returns
 * the diff it *would* apply without performing any write, so the same call powers both `launch plan` and
 * the `launch drift` gate. Registered like a provider/adopter (see {@link import("./registry.js")}); the
 * orchestrator resolves every registered planner and never names a concrete one.
 */
export interface SurfacePlanner {
  /** Stable surface key shown in the plan and accepted as the `launch plan <surface>` argument. */
  id: string;
  /** Which store this surface lives on. */
  store: PlanStore;
  /** Read live state for the in-scope apps and return the diff, performing no writes. */
  plan(ctx: PlanContext): Promise<SurfacePlan>;
}
