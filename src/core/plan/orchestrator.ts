import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { PlanContext, SurfacePlan, SurfacePlanner } from '../types/plan.js';
/**
 * Exit codes, mirroring the `launch status` convention (worst-wins, error first):
 * - `inSync` (0) - config matches live state (or, for plain `launch plan`, an informational run).
 * - `drift` (2) - `--check` only: a surface has pending changes.
 * - `error` (1) - a surface or app couldn't be read; takes precedence over drift, because a gate cannot
 *   honestly certify "no drift" over state it failed to read.
 */
export const PLAN_EXIT = { inSync: 0, error: 1, drift: 2 } as const;
/** A surface that actually produced output - omitted surfaces (nothing declared) are dropped upstream. */
type RenderableSurface = Exclude<
  SurfacePlan,
  {
    state: 'omitted';
  }
>;
/** Options for one plan run. `check` selects the `launch drift` gate semantics over the informational default. */
export type PlanRunOptions = {
  check?: boolean;
};
/**
 * The aggregate result of a plan run, structured so the command can render it and `--json` can serialize
 * it verbatim. `surfaces` excludes omitted surfaces; `changeCount` counts only `planned` actions (real
 * drift, not advisory skips); `appErrorCount` / `skippedSurfaceCount` drive both the summary and the
 * exit code.
 */
export type PlanOutcome = {
  surfaces: RenderableSurface[];
  changeCount: number;
  appErrorCount: number;
  skippedSurfaceCount: number;
  check: boolean;
  exitCode: number;
};
/** What goes into the exit code - extracted as a pure function so the contract is tested directly. */
export type ExitCodeInputs = {
  check: boolean;
  changeCount: number;
  appErrorCount: number;
  skippedSurfaceCount: number;
};
/**
 * Resolve the exit code. Plain `launch plan` is informational - exit 0 even with pending changes, and a
 * missing-credentials skip is benign; only an app-level error (a precondition the user must fix) fails it.
 * `--check` is the gate: an error or an unreadable surface wins (1), then drift (2), then in-sync (0).
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
 * Run every planner concurrently, aggregate their diffs, and compute the exit code. Planners are
 * read-only and self-isolating (each captures its own per-app failures), so this never throws on a
 * surface error - it counts it. Omitted surfaces are dropped before tallying so an unconfigured store
 * adds no noise and no exit pressure.
 */
export const runPlanners = (
  planContext: PlanContext,
  planners: SurfacePlanner[],
  options: PlanRunOptions,
): Effect.Effect<PlanOutcome, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const planned = yield* Effect.forEach(planners, (planner) => planner.plan(planContext), {
      concurrency: 'unbounded',
    });
    const surfaces = planned.filter(
      (surface): surface is RenderableSurface => surface.state !== 'omitted',
    );
    let changeCount = 0;
    let appErrorCount = 0;
    let skippedSurfaceCount = 0;
    for (const surface of surfaces) {
      if (surface.state === 'skipped') {
        skippedSurfaceCount++;
        continue;
      }
      if (surface.scope === 'team') {
        changeCount += surface.actions.filter((action) => action.status === 'planned').length;
        continue;
      }
      for (const app of surface.apps) {
        if (app.error !== undefined) appErrorCount++;
        changeCount += app.actions.filter((action) => action.status === 'planned').length;
      }
    }
    const check = options.check === true;
    return {
      surfaces,
      changeCount,
      appErrorCount,
      skippedSurfaceCount,
      check,
      exitCode: planExitCode({ check, changeCount, appErrorCount, skippedSurfaceCount }),
    };
  });
