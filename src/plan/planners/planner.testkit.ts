import type { PlanContext, SurfacePlan, SurfacePlanner } from '../../types/plan.ts';

/** Execute one planner at the test boundary. */
export async function runPlanner(
  planner: SurfacePlanner,
  planContext: PlanContext,
): Promise<SurfacePlan> {
  return planner.plan(planContext);
}
