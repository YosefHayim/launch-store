/**
 * The App Store Connect product-catalog plan surface: capabilities, in-app purchases, subscriptions, and
 * pricing. Reuses `launch sync`'s {@link buildJobs} (one declared catalog per app) and runs each app's
 * reconciler in dry-run, so the diff it reports is exactly what `launch sync` would apply — minus the
 * listing and screenshot passes, which are their own surfaces. Read-only by construction: every reconcile
 * runs with `dryRun: true`, so `act()` records each change as `planned` and never invokes a write closure.
 */

import { reconcileApp, type AscCatalogApi } from "../../ascSync.js";
import { buildJobs, type SyncJob } from "../../syncJobs.js";
import type { AppPlan, PlanContext, SurfacePlan, SurfacePlanner } from "../types.js";

/** Surface id — also the value users pass as `launch plan catalog`. */
const SURFACE = "catalog";

/** Plan one app's catalog in dry-run, capturing a precondition failure (e.g. no ASC record) as `error`. */
async function planJob(api: AscCatalogApi, job: SyncJob): Promise<AppPlan> {
  try {
    const report = await reconcileApp(api, {
      bundleId: job.bundleId,
      capabilities: job.capabilities,
      products: job.products,
      dryRun: true,
      allowDestructive: false,
    });
    return { app: job.app.name, identifier: job.bundleId, actions: report.actions };
  } catch (error) {
    return {
      app: job.app.name,
      identifier: job.bundleId,
      actions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The catalog planner. Omits itself when no app declares a catalog (nothing to diff); reports a skip with
 * an actionable hint when an Apple account isn't configured (the `--check` gate turns that into an error);
 * otherwise returns the per-app diff. Apps are planned concurrently and isolated — one app's precondition
 * failure is recorded on its {@link AppPlan} and never aborts the rest.
 */
export const catalogPlanner: SurfacePlanner = {
  id: SURFACE,
  store: "appstore",
  async plan(ctx: PlanContext): Promise<SurfacePlan> {
    const jobs = buildJobs(ctx.apps, ctx.config);
    if (jobs.length === 0) return { surface: SURFACE, store: "appstore", state: "omitted" };

    const api = await ctx.resolveAscApi();
    if (!api) {
      return {
        surface: SURFACE,
        store: "appstore",
        state: "skipped",
        reason: "no active Apple account",
        hint: "run `launch creds set-key`",
      };
    }

    const apps = await Promise.all(jobs.map((job) => planJob(api, job)));
    return { surface: SURFACE, store: "appstore", state: "planned", scope: "app", direction: "two-way", apps };
  },
};
