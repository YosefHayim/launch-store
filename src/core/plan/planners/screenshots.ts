import { Effect } from 'effect';
import { reconcileAssetActions } from '@core/store/syncRun.js';
import { buildJobs, type SyncJob } from '@core/store/syncJobs.js';
import { checkScreenshotFile } from '@core/listing/screenshots/specs.js';
import type { PlannedAction } from '@core/types/reconcile.js';
import type { AppPlan, PlanContext, SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan screenshots`. */
const SURFACE = 'screenshots';
/** Whether a job carries any on-disk asset this surface reconciles (screenshots, previews, or review shots). */
const hasAssets = (job: SyncJob): boolean => {
  if (job.screenshots.length > 0) return true;
  if (job.previews.length > 0) return true;
  return job.subscriptionReviewScreenshots.length > 0;
};
/**
 * Advisory dimension checks for a job's on-disk screenshots: any file whose pixels can be measured and
 * fall outside its display type's accepted App Store sizes becomes a `skipped` advisory line, so
 * `launch plan` surfaces a wrong-sized screenshot before App Store Connect rejects the submission.
 * Unmeasurable files (non-image or unreadable) are left to the upload pass - this check only warns, never
 * blocks, mirroring the surface's other advisory `skipped` notes.
 */
const dimensionAdvisories = (job: SyncJob) =>
  Effect.gen(function* () {
    const advisoryActions: PlannedAction[] = [];
    for (const screenshot of job.screenshots) {
      const dimensionCheck = yield* checkScreenshotFile(
        'ios',
        screenshot.displayType,
        screenshot.path,
      );
      if (dimensionCheck.measured && !dimensionCheck.verdict.ok) {
        advisoryActions.push({
          description: `off-spec screenshot ${screenshot.fileName} [${screenshot.locale}/${screenshot.displayType}]: ${dimensionCheck.verdict.reason}`,
          destructive: false,
          status: 'skipped',
        });
      }
    }
    return advisoryActions;
  });
export const screenshotsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext: PlanContext) {
    return Effect.gen(function* () {
      const allJobs = yield* buildJobs(planContext.apps, planContext.config);
      const jobs = allJobs.filter(hasAssets);
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
      const apps: AppPlan[] = yield* Effect.forEach(
        jobs,
        (job) =>
          Effect.gen(function* () {
            const advisoryActions = yield* dimensionAdvisories(job);
            const reconcileActions = yield* reconcileAssetActions(api, job, true, false);
            return {
              app: job.app.name,
              identifier: job.bundleId,
              actions: [...advisoryActions, ...reconcileActions],
            };
          }),
        { concurrency: 'unbounded' },
      );
      return {
        surface: SURFACE,
        store: 'appstore',
        state: 'planned',
        scope: 'app',
        direction: 'additive',
        apps,
      };
    });
  },
};
