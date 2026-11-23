import { describe, expect, it } from 'vitest';
import {
  PLAN_EXIT,
  countPlannedActions,
  planExitCode,
  runPlanners,
  tallyPlanSurfaces,
} from './orchestrator.ts';
import type { LaunchConfig } from '../types/config.ts';
import type { AppPlan, PlanContext, SurfacePlan, SurfacePlanner } from '../types/plan.ts';
import type { PlannedAction } from '../types/reconcile.ts';

/** Minimal context - fake planners ignore it. */
function makeCtx(): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  return {
    config,
    apps: [],
    async resolveAscApi() {
      return null;
    },
    async resolvePlayApi() {
      return null;
    },
  };
}

/** Planner that returns a canned surface. */
function planner(plan: SurfacePlan): SurfacePlanner {
  return {
    id: plan.surface,
    store: plan.store,
    plan() {
      return Promise.resolve(plan);
    },
  };
}

/** Execute the planner orchestrator at the test boundary. */
function runPlannerSet(
  planContext: PlanContext,
  planners: readonly SurfacePlanner[],
  options: Parameters<typeof runPlanners>[2],
) {
  return runPlanners(planContext, planners, options);
}

function action(over: Partial<PlannedAction> = {}): PlannedAction {
  return {
    description: 'create in-app purchase com.acme.coins',
    destructive: false,
    status: 'planned',
    ...over,
  };
}

function appPlan(over: Partial<AppPlan> = {}): AppPlan {
  return { app: 'alpha', identifier: 'com.acme.alpha', actions: [action()], ...over };
}

function planned(surface: string, apps: AppPlan[]): SurfacePlan {
  return { surface, store: 'appstore', state: 'planned', scope: 'app', direction: 'two-way', apps };
}

/** Team-level planned surface (wallet / EU distribution). */
function plannedTeam(surface: string, actions: PlannedAction[]): SurfacePlan {
  return {
    surface,
    store: 'appstore',
    state: 'planned',
    scope: 'team',
    direction: 'additive',
    actions,
  };
}
function describeCountPlannedActions() {
  function countsOnlyPlannedStatusActions() {
    const plannedActions = countPlannedActions([
      action(),
      action({ status: 'skipped' }),
      action({ status: 'planned' }),
    ]);

    expect(plannedActions).toBe(2);
  }

  it('counts only planned status actions', countsOnlyPlannedStatusActions);
}

describe('countPlannedActions', describeCountPlannedActions);
function describeTallyPlanSurfaces() {
  function dropsNothingFromThePieceAndTalliesTeamAppSkipAndErrorCases() {
    const tallies = tallyPlanSurfaces([
      {
        surface: 'catalog',
        store: 'appstore',
        state: 'planned',
        scope: 'app',
        direction: 'two-way',
        apps: [
          appPlan({ actions: [action(), action({ status: 'skipped' })] }),
          appPlan({ app: 'beta', actions: [], error: 'missing record' }),
        ],
      },
      {
        surface: 'wallet',
        store: 'appstore',
        state: 'planned',
        scope: 'team',
        direction: 'additive',
        actions: [action()],
      },
      {
        surface: 'play-products',
        store: 'play',
        state: 'skipped',
        reason: 'no Play credentials',
      },
    ]);

    expect(tallies.changeCount).toBe(2);
    expect(tallies.appErrorCount).toBe(1);
    expect(tallies.skippedSurfaceCount).toBe(1);
  }

  it(
    'drops nothing from the input and tallies team, app, skip, and error cases',
    dropsNothingFromThePieceAndTalliesTeamAppSkipAndErrorCases,
  );
}

describe('tallyPlanSurfaces', describeTallyPlanSurfaces);
function describePlanExitCode() {
  function plainRunIsInformationalExit0EvenWithPendingChangesOrSkips() {
    const exitCode = planExitCode({
      check: false,
      changeCount: 5,
      appErrorCount: 0,
      skippedSurfaceCount: 2,
    });

    expect(exitCode).toBe(PLAN_EXIT.inSync);
  }

  it(
    'plain run is informational - exit 0 even with pending changes or skips',
    plainRunIsInformationalExit0EvenWithPendingChangesOrSkips,
  );

  function plainRunStillFailsOnAnAppLevelError() {
    const exitCode = planExitCode({
      check: false,
      changeCount: 0,
      appErrorCount: 1,
      skippedSurfaceCount: 0,
    });

    expect(exitCode).toBe(PLAN_EXIT.error);
  }

  it('plain run still fails on an app-level error', plainRunStillFailsOnAnAppLevelError);

  function checkRunGradesDrift2ThenInSync0() {
    const exitCode = planExitCode({
      check: true,
      changeCount: 0,
      appErrorCount: 0,
      skippedSurfaceCount: 0,
    });

    expect(exitCode).toBe(PLAN_EXIT.inSync);
    expect(
      planExitCode({ check: true, changeCount: 3, appErrorCount: 0, skippedSurfaceCount: 0 }),
    ).toBe(PLAN_EXIT.drift);
  }

  it('check run grades drift (2), then in-sync (0)', checkRunGradesDrift2ThenInSync0);

  function checkRunTreatsAnUnreadableSurfaceAsAnError() {
    const exitCode = planExitCode({
      check: true,
      changeCount: 0,
      appErrorCount: 0,
      skippedSurfaceCount: 1,
    });

    expect(exitCode).toBe(PLAN_EXIT.error);
  }

  it(
    'check run treats an unreadable surface as an error',
    checkRunTreatsAnUnreadableSurfaceAsAnError,
  );

  function errorWinsOverDriftInACheckRun() {
    const exitCode = planExitCode({
      check: true,
      changeCount: 3,
      appErrorCount: 1,
      skippedSurfaceCount: 0,
    });

    expect(exitCode).toBe(PLAN_EXIT.error);
  }

  it('error wins over drift in a check run', errorWinsOverDriftInACheckRun);
}

describe('planExitCode', describePlanExitCode);
function describeRunPlanners() {
  async function dropsOmittedSurfacesAndCountsOnlyPlannedActionsAsDrift() {
    const outcome = await runPlannerSet(
      makeCtx(),
      [
        planner(
          planned('catalog', [appPlan({ actions: [action(), action({ status: 'skipped' })] })]),
        ),
        planner({ surface: 'listing', store: 'appstore', state: 'omitted' }),
      ],
      {},
    );

    expect(outcome.surfaces).toHaveLength(1);
    expect(outcome.changeCount).toBe(1);
  }

  it(
    'drops omitted surfaces and counts only planned actions as drift',
    dropsOmittedSurfacesAndCountsOnlyPlannedActionsAsDrift,
  );

  async function aPlainRunWithDriftIsInformationalExit0() {
    const outcome = await runPlannerSet(makeCtx(), [planner(planned('catalog', [appPlan()]))], {});
    expect(outcome.changeCount).toBe(1);
    expect(outcome.exitCode).toBe(PLAN_EXIT.inSync);
  }

  it('a plain run with drift is informational (exit 0)', aPlainRunWithDriftIsInformationalExit0);

  async function aCheckRunWithDriftExits2() {
    const outcome = await runPlannerSet(makeCtx(), [planner(planned('catalog', [appPlan()]))], {
      check: true,
    });
    expect(outcome.exitCode).toBe(PLAN_EXIT.drift);
  }

  it('a check run with drift exits 2', aCheckRunWithDriftExits2);

  async function countsATeamScopedSurfaceSPlannedActionsAsDrift() {
    const outcome = await runPlannerSet(makeCtx(), [planner(plannedTeam('wallet', [action()]))], {
      check: true,
    });

    expect(outcome.changeCount).toBe(1);
    expect(outcome.exitCode).toBe(PLAN_EXIT.drift);
  }

  it(
    "counts a team-scoped surface's planned actions as drift",
    countsATeamScopedSurfaceSPlannedActionsAsDrift,
  );

  async function aCheckRunWithASkippedUnreadableSurfaceExits1() {
    const outcome = await runPlannerSet(
      makeCtx(),
      [
        planner({
          surface: 'play-products',
          store: 'play',
          state: 'skipped',
          reason: 'no Play credentials',
        }),
      ],
      { check: true },
    );

    expect(outcome.skippedSurfaceCount).toBe(1);
    expect(outcome.exitCode).toBe(PLAN_EXIT.error);
  }

  it(
    'a check run with a skipped (unreadable) surface exits 1',
    aCheckRunWithASkippedUnreadableSurfaceExits1,
  );

  async function anAppLevelErrorFailsBothPlainAndCheckRuns() {
    const planners = [
      planner(
        planned('catalog', [appPlan({ actions: [], error: 'no App Store Connect app record' })]),
      ),
    ];
    const plannerSet = await runPlannerSet(makeCtx(), planners, {});

    expect(plannerSet.exitCode).toBe(PLAN_EXIT.error);
    expect((await runPlannerSet(makeCtx(), planners, { check: true })).exitCode).toBe(
      PLAN_EXIT.error,
    );
  }

  it(
    'an app-level error fails both plain and check runs',
    anAppLevelErrorFailsBothPlainAndCheckRuns,
  );
}

describe('runPlanners', describeRunPlanners);
