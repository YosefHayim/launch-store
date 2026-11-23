import type { PlanContext, SurfacePlan, SurfacePlanner } from '../types/plan.ts';
import type { PlannedAction } from '../types/reconcile.ts';

/** Exit codes mirror `launch-store status` (worst-wins, error first): */
export const PLAN_EXIT = { inSync: 0, error: 1, drift: 2 } as const;

/** Surfaces that produced output; omitted (nothing declared) are dropped upstream. */
type RenderableSurface = Exclude<
  SurfacePlan,
  {
    state: 'omitted';
  }
>;

/** Options for one plan run. `check` selects drift-gate exit semantics. */
type PlanRunOptions = Readonly<{
  check?: boolean;
}>;

/** Aggregate plan outcome for rendering and `--json`. */
export type PlanOutcome = Readonly<{
  surfaces: readonly RenderableSurface[];
  changeCount: number;
  appErrorCount: number;
  skippedSurfaceCount: number;
  check: boolean;
  exitCode: number;
}>;

/** Inputs for {@link planExitCode}, extracted so the contract is unit-tested pure. */
type ExitCodeInputs = Readonly<{
  check: boolean;
  changeCount: number;
  appErrorCount: number;
  skippedSurfaceCount: number;
}>;

/** Drift and failure tallies over renderable surfaces. */
type PlanSurfaceTallies = Readonly<{
  changeCount: number;
  appErrorCount: number;
  skippedSurfaceCount: number;
}>;

function isPlannedAction(action: PlannedAction): boolean {
  return action.status == 'planned';
}

/** Count actions with `planned` status (real drift, not advisory skips). */
export function countPlannedActions(actions: readonly PlannedAction[]): number {
  let plannedCount = 0;

  for (const action of actions) {
    const isPlanned = isPlannedAction(action);

    if (isPlanned) {
      plannedCount += 1;
    }
  }

  return plannedCount;
}

function isRenderableSurface(surface: SurfacePlan): surface is RenderableSurface {
  return surface.state != 'omitted';
}

/** Tally planned changes, per-app errors, and unreadable surfaces. */
export function tallyPlanSurfaces(surfaces: readonly RenderableSurface[]): PlanSurfaceTallies {
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
              const hasAppError = appPlan.error != null;

              if (hasAppError) {
                appErrorCount += 1;
              }

              changeCount += countPlannedActions(appPlan.actions);
            }

            break;
        }

        break;
    }
  }

  return { changeCount, appErrorCount, skippedSurfaceCount };
}

/** Plain `launch-store plan` is informational (exit 0 with drift/skips) */
export function planExitCode({
  check,
  changeCount,
  appErrorCount,
  skippedSurfaceCount,
}: ExitCodeInputs): number {
  const isPlainRun = check == false;

  if (isPlainRun) {
    const hasPlainAppError = appErrorCount > 0;

    if (hasPlainAppError) {
      return PLAN_EXIT.error;
    }

    return PLAN_EXIT.inSync;
  }

  const hasAppError = appErrorCount > 0;

  if (hasAppError) {
    return PLAN_EXIT.error;
  }

  const hasSkippedSurface = skippedSurfaceCount > 0;

  if (hasSkippedSurface) {
    return PLAN_EXIT.error;
  }

  const hasDrift = changeCount > 0;

  if (hasDrift) {
    return PLAN_EXIT.drift;
  }

  return PLAN_EXIT.inSync;
}

/** Run planners concurrently, drop omitted surfaces, tally diffs, and compute the exit code. */
export async function runPlanners(
  planContext: PlanContext,
  planners: readonly SurfacePlanner[],
  options: PlanRunOptions,
): Promise<PlanOutcome> {
  function startPlanner(planner: SurfacePlanner): Promise<SurfacePlan> {
    return planner.plan(planContext);
  }

  const plannerRuns = planners.map(startPlanner);
  const planned = await Promise.all(plannerRuns);
  const surfaces = planned.filter(isRenderableSurface);
  const tallies = tallyPlanSurfaces(surfaces);
  let check = false;

  const isCheckRun = options.check == true;

  if (isCheckRun) {
    check = true;
  }

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
}
