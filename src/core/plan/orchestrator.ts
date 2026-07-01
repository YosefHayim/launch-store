/**
 * The `launch plan` / `launch drift` engine: run every registered {@link SurfacePlanner} in dry-run,
 * aggregate the diffs, and map the result to the process exit code. UI-free, like `core/ascSync.ts` — the
 * command (`cli/commands/plan.ts`) renders the outcome and resolves credentials; this module only
 * orchestrates and tallies, so the exit-code contract is unit-testable against fake planners with no
 * network. See `docs/adr/0003-plan-drift.md`.
 */

import type { PlanContext, SurfacePlan, SurfacePlanner } from '../types.js';

/**
 * Exit codes, mirroring the `launch status` convention (worst-wins, error first):
 * - `inSync` (0) — config matches live state (or, for plain `launch plan`, an informational run).
 * - `drift` (2) — `--check` only: a surface has pending changes.
 * - `error` (1) — a surface or app couldn't be read; takes precedence over drift, because a gate cannot
 *   honestly certify "no drift" over state it failed to read.
 */
export const PLAN_EXIT = { inSync: 0, error: 1, drift: 2 } as const;

/** A surface that actually produced output — omitted surfaces (nothing declared) are dropped upstream. */
type RenderableSurface = Exclude<SurfacePlan, { state: 'omitted' }>;

/** Options for one plan run. `check` selects the `launch drift` gate semantics over the informational default. */
export interface PlanRunOptions {
  /** Treat drift as a failure (exit 2) and an unreadable surface as an error (exit 1) — the CI gate. */
  check?: boolean;
}

/**
 * The aggregate result of a plan run, structured so the command can render it and `--json` can serialize
 * it verbatim. `surfaces` excludes omitted surfaces; `changeCount` counts only `planned` actions (real
 * drift, not advisory skips); `appErrorCount` / `skippedSurfaceCount` drive both the summary and the
 * exit code.
 */
export interface PlanOutcome {
  surfaces: RenderableSurface[];
  /** Total `planned` actions across every surface — the headline "N change(s)" / drift signal. */
  changeCount: number;
  /** Apps that threw a precondition and couldn't be planned. */
  appErrorCount: number;
  /** Declared surfaces that couldn't be read (e.g. missing credentials). */
  skippedSurfaceCount: number;
  /** Whether this was a `--check` / `drift` run (changes the exit-code meaning). */
  check: boolean;
  /** The resolved process exit code per the {@link PLAN_EXIT} contract. */
  exitCode: number;
}

/** What goes into the exit code — extracted as a pure function so the contract is tested directly. */
export interface ExitCodeInputs {
  check: boolean;
  changeCount: number;
  appErrorCount: number;
  skippedSurfaceCount: number;
}

/**
 * Resolve the exit code. Plain `launch plan` is informational — exit 0 even with pending changes, and a
 * missing-credentials skip is benign; only an app-level error (a precondition the user must fix) fails it.
 * `--check` is the gate: an error or an unreadable surface wins (1), then drift (2), then in-sync (0).
 */
export function planExitCode({
  check,
  changeCount,
  appErrorCount,
  skippedSurfaceCount,
}: ExitCodeInputs): number {
  if (check) {
    if (appErrorCount > 0 || skippedSurfaceCount > 0) return PLAN_EXIT.error;
    if (changeCount > 0) return PLAN_EXIT.drift;
    return PLAN_EXIT.inSync;
  }
  return appErrorCount > 0 ? PLAN_EXIT.error : PLAN_EXIT.inSync;
}

/**
 * Run every planner concurrently, aggregate their diffs, and compute the exit code. Planners are
 * read-only and self-isolating (each captures its own per-app failures), so this never throws on a
 * surface error — it counts it. Omitted surfaces are dropped before tallying so an unconfigured store
 * adds no noise and no exit pressure.
 */
export async function runPlanners(
  ctx: PlanContext,
  planners: SurfacePlanner[],
  options: PlanRunOptions,
): Promise<PlanOutcome> {
  const planned = await Promise.all(planners.map((planner) => planner.plan(ctx)));
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
}
