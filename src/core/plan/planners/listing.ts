import { Effect } from 'effect';
import { reconcileAppListing, type AscCatalogApi } from '@core/store/ascSync.js';
import { buildJobs, hasListing } from '@core/store/syncJobs.js';
import type { AppleStoreConfig } from '@core/store/storeConfig.js';
import { errorMessage } from '@core/services/errorMessage.js';
import type { AppPlan, PlanContext, SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan listing`. */
const SURFACE = 'listing';
/** One app's listing-plan target: the job's bundle id paired with its present (non-empty) listing. */
type ListingTarget = {
  app: string;
  bundleId: string;
  listing: AppleStoreConfig;
};
/** Plan one app's listing in dry-run, capturing a precondition failure (e.g. no ASC record) as `error`. */
const planTarget = (api: AscCatalogApi, target: ListingTarget): Effect.Effect<AppPlan> =>
  reconcileAppListing(api, {
    bundleId: target.bundleId,
    listing: target.listing,
    dryRun: true,
  }).pipe(
    Effect.match({
      onSuccess: (report): AppPlan => ({
        app: target.app,
        identifier: target.bundleId,
        actions: report.actions,
      }),
      onFailure: (reconciliationFailure): AppPlan => ({
        app: target.app,
        identifier: target.bundleId,
        actions: [],
        error: errorMessage(reconciliationFailure),
      }),
    }),
  );
/**
 * The listing planner. Omits itself when no app declares a non-empty `store.config.json` listing; reports
 * a skip with an actionable hint when an Apple account isn't configured (the `--check` gate turns that
 * into an error); otherwise returns the per-app diff. Apps are planned concurrently and isolated - one
 * app's precondition failure is recorded on its {@link AppPlan} and never aborts the rest.
 */
export const listingPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext: PlanContext) {
    return Effect.gen(function* () {
      const jobs = yield* buildJobs(planContext.apps, planContext.config);
      const targets = jobs.flatMap((job) => {
        if (hasListing(job.listing)) {
          return [{ app: job.app.name, bundleId: job.bundleId, listing: job.listing }];
        }
        return [];
      });
      if (targets.length === 0) return { surface: SURFACE, store: 'appstore', state: 'omitted' };
      const api = yield* planContext.resolveAscApi();
      if (!api) {
        return {
          surface: SURFACE,
          store: 'appstore',
          state: 'skipped',
          reason: 'no active Apple account',
          hint: 'run `launch creds set-key`',
        };
      }
      const apps = yield* Effect.forEach(targets, (target) => planTarget(api, target), {
        concurrency: 'unbounded',
      });
      return {
        surface: SURFACE,
        store: 'appstore',
        state: 'planned',
        scope: 'app',
        direction: 'two-way',
        apps,
      };
    });
  },
};
