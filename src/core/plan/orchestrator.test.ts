import { describe, expect, it } from "vitest";
import { PLAN_EXIT, planExitCode, runPlanners } from "./orchestrator.js";
import type { AppPlan, PlanContext, SurfacePlan, SurfacePlanner } from "./types.js";
import type { PlannedAction } from "../ascSync.js";
import type { LaunchConfig } from "../types.js";

/** A minimal context — fake planners ignore it, but the types must be honored without casts. */
function makeCtx(): PlanContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: "local",
    storage: "local",
    buildEngine: "fastlane",
    submit: "app-store-connect",
  };
  return {
    config,
    apps: [],
    resolveAscApi: () => Promise.resolve(null),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

/** A planner that returns a canned surface, ignoring its context. */
function planner(plan: SurfacePlan): SurfacePlanner {
  return { id: plan.surface, store: plan.store, plan: () => Promise.resolve(plan) };
}

function action(over: Partial<PlannedAction> = {}): PlannedAction {
  return { description: "create in-app purchase com.acme.coins", destructive: false, status: "planned", ...over };
}

function appPlan(over: Partial<AppPlan> = {}): AppPlan {
  return { app: "alpha", identifier: "com.acme.alpha", actions: [action()], ...over };
}

function planned(surface: string, apps: AppPlan[]): SurfacePlan {
  return { surface, store: "appstore", state: "planned", scope: "app", direction: "two-way", apps };
}

/** A team-level planned surface (wallet / EU distribution): actions, no per-app grouping (ADR 0003 A5). */
function plannedTeam(surface: string, actions: PlannedAction[]): SurfacePlan {
  return { surface, store: "appstore", state: "planned", scope: "team", direction: "additive", actions };
}

describe("planExitCode", () => {
  it("plain run is informational — exit 0 even with pending changes or skips", () => {
    expect(planExitCode({ check: false, changeCount: 5, appErrorCount: 0, skippedSurfaceCount: 2 })).toBe(
      PLAN_EXIT.inSync,
    );
  });

  it("plain run still fails on an app-level error", () => {
    expect(planExitCode({ check: false, changeCount: 0, appErrorCount: 1, skippedSurfaceCount: 0 })).toBe(
      PLAN_EXIT.error,
    );
  });

  it("check run grades drift (2), then in-sync (0)", () => {
    expect(planExitCode({ check: true, changeCount: 0, appErrorCount: 0, skippedSurfaceCount: 0 })).toBe(
      PLAN_EXIT.inSync,
    );
    expect(planExitCode({ check: true, changeCount: 3, appErrorCount: 0, skippedSurfaceCount: 0 })).toBe(
      PLAN_EXIT.drift,
    );
  });

  it("check run treats an unreadable surface as an error", () => {
    expect(planExitCode({ check: true, changeCount: 0, appErrorCount: 0, skippedSurfaceCount: 1 })).toBe(
      PLAN_EXIT.error,
    );
  });

  it("error wins over drift in a check run", () => {
    expect(planExitCode({ check: true, changeCount: 3, appErrorCount: 1, skippedSurfaceCount: 0 })).toBe(
      PLAN_EXIT.error,
    );
  });
});

describe("runPlanners", () => {
  it("drops omitted surfaces and counts only planned actions as drift", async () => {
    const outcome = await runPlanners(
      makeCtx(),
      [
        planner(planned("catalog", [appPlan({ actions: [action(), action({ status: "skipped" })] })])),
        planner({ surface: "listing", store: "appstore", state: "omitted" }),
      ],
      {},
    );
    expect(outcome.surfaces).toHaveLength(1);
    expect(outcome.changeCount).toBe(1); // the advisory "skipped" action is not drift
  });

  it("a plain run with drift is informational (exit 0)", async () => {
    const outcome = await runPlanners(makeCtx(), [planner(planned("catalog", [appPlan()]))], {});
    expect(outcome.changeCount).toBe(1);
    expect(outcome.exitCode).toBe(PLAN_EXIT.inSync);
  });

  it("a check run with drift exits 2", async () => {
    const outcome = await runPlanners(makeCtx(), [planner(planned("catalog", [appPlan()]))], { check: true });
    expect(outcome.exitCode).toBe(PLAN_EXIT.drift);
  });

  it("counts a team-scoped surface's planned actions as drift", async () => {
    const outcome = await runPlanners(makeCtx(), [planner(plannedTeam("wallet", [action()]))], { check: true });
    expect(outcome.changeCount).toBe(1);
    expect(outcome.exitCode).toBe(PLAN_EXIT.drift);
  });

  it("a check run with a skipped (unreadable) surface exits 1", async () => {
    const outcome = await runPlanners(
      makeCtx(),
      [planner({ surface: "play-products", store: "play", state: "skipped", reason: "no Play credentials" })],
      { check: true },
    );
    expect(outcome.skippedSurfaceCount).toBe(1);
    expect(outcome.exitCode).toBe(PLAN_EXIT.error);
  });

  it("an app-level error fails both plain and check runs", async () => {
    const planners = [
      planner(planned("catalog", [appPlan({ actions: [], error: "no App Store Connect app record" })])),
    ];
    expect((await runPlanners(makeCtx(), planners, {})).exitCode).toBe(PLAN_EXIT.error);
    expect((await runPlanners(makeCtx(), planners, { check: true })).exitCode).toBe(PLAN_EXIT.error);
  });
});
