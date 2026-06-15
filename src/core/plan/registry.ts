/**
 * The surface-planner registry — the same "implement an interface + register it" seam the provider and
 * adopter registries use (`src/providers/index.ts`, `src/core/adopt/registry.ts`), scoped to
 * `launch plan` / `launch drift`. The orchestrator walks {@link listSurfacePlanners} and never names a
 * concrete surface, so adding the listing / Play-products / Play-subscriptions surfaces (and the other
 * config-as-code surfaces after them) is a new planner file plus one {@link registerSurfacePlanner} line
 * in {@link registerBuiltinPlanners} — the orchestrator is untouched.
 */

import type { SurfacePlanner } from "./types.js";
import { catalogPlanner } from "./planners/catalog.js";

/** Registered planners, keyed by surface id so re-registering one replaces it (idempotent built-in wiring). */
const PLANNERS = new Map<string, SurfacePlanner>();

/** Register (or replace) a surface planner by its id. */
export function registerSurfacePlanner(planner: SurfacePlanner): void {
  PLANNERS.set(planner.id, planner);
}

/** Every registered planner, in registration order — the orchestrator's full work list. */
export function listSurfacePlanners(): SurfacePlanner[] {
  return [...PLANNERS.values()];
}

/**
 * Register the v1 built-in planners. Idempotent: safe to call from the command entry and from tests
 * without duplicating. The listing, Play-products, and Play-subscriptions planners register here as they
 * land (see `docs/adr/0003-plan-drift.md`).
 */
export function registerBuiltinPlanners(): void {
  registerSurfacePlanner(catalogPlanner);
}
