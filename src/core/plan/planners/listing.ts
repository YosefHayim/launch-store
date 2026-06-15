/**
 * The App Store textual-listing plan surface: per-locale name/subtitle/privacy URL (app level) and
 * description/keywords/what's-new/promo/URLs (version level), declared in each app's `store.config.json`.
 * Reuses `launch sync`'s {@link buildJobs} to discover which apps carry a listing, then runs the
 * listing-only reconcile ({@link reconcileAppListing}) in dry-run — so the diff it reports is exactly what
 * `launch sync` would apply for the listing, with the capability/IAP/subscription passes (the `catalog`
 * surface's job) left out. Read-only by construction: the reconcile runs with `dryRun: true`, so `act()`
 * records each change as `planned` and never invokes a write closure.
 */

import { reconcileAppListing, type AscCatalogApi } from "../../ascSync.js";
import { buildJobs, hasListing } from "../../syncJobs.js";
import type { AppleStoreConfig } from "../../storeConfig.js";
import type { AppPlan, PlanContext, SurfacePlan, SurfacePlanner } from "../types.js";

/** Surface id — also the value users pass as `launch plan listing`. */
const SURFACE = "listing";

/** One app's listing-plan target: the job's bundle id paired with its present (non-empty) listing. */
interface ListingTarget {
  app: string;
  bundleId: string;
  listing: AppleStoreConfig;
}

/** Plan one app's listing in dry-run, capturing a precondition failure (e.g. no ASC record) as `error`. */
async function planTarget(api: AscCatalogApi, target: ListingTarget): Promise<AppPlan> {
  try {
    const report = await reconcileAppListing(api, {
      bundleId: target.bundleId,
      listing: target.listing,
      dryRun: true,
    });
    return { app: target.app, identifier: target.bundleId, actions: report.actions };
  } catch (error) {
    return {
      app: target.app,
      identifier: target.bundleId,
      actions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The listing planner. Omits itself when no app declares a non-empty `store.config.json` listing; reports
 * a skip with an actionable hint when an Apple account isn't configured (the `--check` gate turns that
 * into an error); otherwise returns the per-app diff. Apps are planned concurrently and isolated — one
 * app's precondition failure is recorded on its {@link AppPlan} and never aborts the rest.
 */
export const listingPlanner: SurfacePlanner = {
  id: SURFACE,
  store: "appstore",
  async plan(ctx: PlanContext): Promise<SurfacePlan> {
    const targets = buildJobs(ctx.apps, ctx.config).flatMap((job) =>
      hasListing(job.listing) ? [{ app: job.app.name, bundleId: job.bundleId, listing: job.listing }] : [],
    );
    if (targets.length === 0) return { surface: SURFACE, store: "appstore", state: "omitted" };

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

    const apps = await Promise.all(targets.map((target) => planTarget(api, target)));
    return { surface: SURFACE, store: "appstore", state: "planned", apps };
  },
};
