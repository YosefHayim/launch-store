import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { PlanContext, SurfacePlan, SurfacePlanner } from '../types/plan.js';
import type { PlannedAction } from '../types/reconcile.js';

/**
 * Exit codes mirror `launch status` (worst-wins, error first):
 * - `inSync` (0) - config matches live state, or plain `launch plan` with only drift/skips
 * - `error` (1) - unreadable surface/app; a gate cannot certify state it failed to read
 * - `drift` (2) - `--check` only: pending planned actions
 */
export const PLAN_EXIT = { inSync: 0, error: 1, drift: 2 } as const;

/** Surfaces that produced output; omitted (nothing declared) are dropped upstream. */
export type RenderableSurface = Exclude<
  SurfacePlan,
  {
    state: 'omitted';
  }
>;

/** Options for one plan run. `check` selects drift-gate exit semantics. */
export type PlanRunOptions = Readonly<{
  check?: boolean;
}>;

/**
 * Aggregate plan outcome for rendering and `--json`.
 * `changeCount` counts only `planned` actions (not advisory skips).
 */
export type PlanOutcome = Readonly<{
  surfaces: readonly RenderableSurface[];
  changeCount: number;
  appErrorCount: number;
  skippedSurfaceCount: number;
  check: boolean;
  exitCode: number;
}>;

/** Inputs for {@link planExitCode}, extracted so the contract is unit-tested pure. */
export type ExitCodeInputs = Readonly<{
  check: boolean;
  changeCount: number;
  appErrorCount: number;
  skippedSurfaceCount: number;
}>;

/** Drift and failure tallies over renderable surfaces. */
export type PlanSurfaceTallies = Readonly<{
  changeCount: number;
  appErrorCount: number;
  skippedSurfaceCount: number;
}>;

/** Count actions with `planned` status (real drift, not advisory skips). */
export const countPlannedActions = (actions: readonly PlannedAction[]): number => {
  let plannedCount = 0;
  for (const action of actions) {
    if (action.status === 'planned') plannedCount += 1;
  }
  return plannedCount;
};

/** Tally planned changes, per-app errors, and unreadable surfaces. */
export const tallyPlanSurfaces = (surfaces: readonly RenderableSurface[]): PlanSurfaceTallies => {
  let changeCount = 0;
  let appErrorCount = 0;
  let skippedSurfaceCount = 0;
  for (const surface of surfaces) {
    switch (surface.state) {
      case 'skipped':
        skippedSurfaceCount += 1;
        break;
      case 'planned':
        switch (surface.scope) {
          case 'team':
            changeCount += countPlannedActions(surface.actions);
            break;
          case 'app':
            for (const appPlan of surface.apps) {
              if (appPlan.error !== undefined) appErrorCount += 1;
              changeCount += countPlannedActions(appPlan.actions);
            }
            break;
        }
        break;
    }
  }
  return { changeCount, appErrorCount, skippedSurfaceCount };
};

/**
 * Plain `launch plan` is informational (exit 0 with drift/skips); only app-level errors fail it.
 * `--check` / `drift` is the gate: unreadable state wins (1), then drift (2), then in-sync (0).
 */
export const planExitCode = ({
  check,
  changeCount,
  appErrorCount,
  skippedSurfaceCount,
}: ExitCodeInputs): number => {
  if (check) {
    if (appErrorCount > 0) return PLAN_EXIT.error;
    if (skippedSurfaceCount > 0) return PLAN_EXIT.error;
    if (changeCount > 0) return PLAN_EXIT.drift;
    return PLAN_EXIT.inSync;
  }
  if (appErrorCount > 0) return PLAN_EXIT.error;
  return PLAN_EXIT.inSync;
};

/**
 * Run planners concurrently, drop omitted surfaces, tally diffs, and compute the exit code.
 * Planners self-isolate per-app failures; this only aggregates.
 */
export const runPlanners = (
  planContext: PlanContext,
  planners: readonly SurfacePlanner[],
  options: PlanRunOptions,
): Effect.Effect<PlanOutcome, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const planned = yield* Effect.forEach(planners, (planner) => planner.plan(planContext), {
      concurrency: 'unbounded',
    });
    const surfaces = planned.filter(
      (surface): surface is RenderableSurface => surface.state !== 'omitted',
    );
    const tallies = tallyPlanSurfaces(surfaces);
    let check = false;
    if (options.check === true) check = true;
    return {
      surfaces,
      changeCount: tallies.changeCount,
      appErrorCount: tallies.appErrorCount,
      skippedSurfaceCount: tallies.skippedSurfaceCount,
      check,
      exitCode: planExitCode({
        check,
        changeCount: tallies.changeCount,
        appErrorCount: tallies.appErrorCount,
        skippedSurfaceCount: tallies.skippedSurfaceCount,
      }),
    };
  });
