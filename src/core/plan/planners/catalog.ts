import { Effect } from 'effect';
import { reconcileApp, type AscCatalogApi } from '@core/store/ascSync.js';
import { buildJobs, type SyncJob } from '@core/store/syncJobs.js';
import { errorMessage } from '@core/services/errorMessage.js';
import type { AppPlan, PlanContext, SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan catalog`. */
const SURFACE = 'catalog';
/** Plan one app's catalog in dry-run, capturing a precondition failure (e.g. no ASC record) as `error`. */
const planJob = (api: AscCatalogApi, job: SyncJob): Effect.Effect<AppPlan> =>
  reconcileApp(api, {
    bundleId: job.bundleId,
    capabilities: job.capabilities,
    products: job.products,
    dryRun: true,
    allowDestructive: false,
  }).pipe(
    Effect.match({
      onSuccess: (report): AppPlan => ({
        app: job.app.name,
        identifier: job.bundleId,
        actions: report.actions,
      }),
      onFailure: (reconciliationFailure): AppPlan => ({
        app: job.app.name,
        identifier: job.bundleId,
        actions: [],
        error: errorMessage(reconciliationFailure),
      }),
    }),
  );
/**
 * The catalog planner. Omits itself when no app declares a catalog (nothing to diff); reports a skip with
 * an actionable hint when an Apple account isn't configured (the `--check` gate turns that into an error);
 * otherwise returns the per-app diff. Apps are planned concurrently and isolated - one app's precondition
 * failure is recorded on its {@link AppPlan} and never aborts the rest.
 */
export const catalogPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext: PlanContext) {
    return Effect.gen(function* () {
      const jobs = yield* buildJobs(planContext.apps, planContext.config);
      if (jobs.length === 0) return { surface: SURFACE, store: 'appstore', state: 'omitted' };
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
      const apps = yield* Effect.forEach(jobs, (job) => planJob(api, job), {
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
