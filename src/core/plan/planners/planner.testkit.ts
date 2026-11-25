import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import type { PlanContext, SurfacePlan, SurfacePlanner } from '@core/types/plan.js';

/** Execute one planner at the test boundary. */
export const runPlanner = (
  planner: SurfacePlanner,
  planContext: PlanContext,
): Promise<SurfacePlan> =>
  Effect.runPromise(planner.plan(planContext).pipe(Effect.provide(NodeContext.layer)));
