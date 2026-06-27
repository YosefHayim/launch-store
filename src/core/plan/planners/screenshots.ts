/**
 * The App Store **screenshots** plan surface: the per-locale iPhone/iPad screenshots and app-preview videos
 * discovered on disk, plus subscription review screenshots. Reuses `launch sync`'s {@link buildJobs} (asset
 * discovery + fingerprinting) and {@link reconcileAssetActions} (the exact screenshot + preview passes sync
 * applies) in dry-run, so the diff it reports is precisely what `launch sync` would upload — minus the catalog
 * and listing passes, which are their own surfaces.
 *
 * Additive: the reconciler uploads only the locally-present assets Apple is missing (matched by checksum) and
 * never deletes, so a `= in sync` result means "every local asset is uploaded," not that the portal holds no
 * extras. The asset passes are total — a per-pass failure surfaces as a `failed` action rather than throwing —
 * so no per-app `error` arm is needed (unlike the catalog surface, whose reconciler throws on a missing record).
 */

import { reconcileAssetActions } from '../../syncRun.js';
import { buildJobs, type SyncJob } from '../../syncJobs.js';
import { checkScreenshotFile } from '../../screenshotSpecs.js';
import type { PlannedAction } from '../../ascSync.js';
import type { AppPlan, PlanContext, SurfacePlan, SurfacePlanner } from '../types.js';

/** Surface id — also the value users pass as `launch plan screenshots`. */
const SURFACE = 'screenshots';

/** Whether a job carries any on-disk asset this surface reconciles (screenshots, previews, or review shots). */
function hasAssets(job: SyncJob): boolean {
  return (
    job.screenshots.length > 0 ||
    job.previews.length > 0 ||
    job.subscriptionReviewScreenshots.length > 0
  );
}

/**
 * Advisory dimension checks for a job's on-disk screenshots: any file whose pixels can be measured and
 * fall outside its display type's accepted App Store sizes becomes a `skipped` advisory line, so
 * `launch plan` surfaces a wrong-sized screenshot before App Store Connect rejects the submission.
 * Unmeasurable files (non-image or unreadable) are left to the upload pass — this check only warns, never
 * blocks, mirroring the surface's other advisory `skipped` notes.
 */
function dimensionAdvisories(job: SyncJob): PlannedAction[] {
  const advisories: PlannedAction[] = [];
  for (const shot of job.screenshots) {
    const check = checkScreenshotFile('ios', shot.displayType, shot.path);
    if (check.measured && !check.verdict.ok) {
      advisories.push({
        description: `off-spec screenshot ${shot.fileName} [${shot.locale}/${shot.displayType}]: ${check.verdict.reason}`,
        destructive: false,
        status: 'skipped',
      });
    }
  }
  return advisories;
}

export const screenshotsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  async plan(ctx: PlanContext): Promise<SurfacePlan> {
    const jobs = buildJobs(ctx.apps, ctx.config).filter(hasAssets);
    if (jobs.length === 0) return { surface: SURFACE, store: 'appstore', state: 'omitted' };

    const api = await ctx.resolveAscApi();
    if (!api) {
      return {
        surface: SURFACE,
        store: 'appstore',
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch creds set-key`',
      };
    }

    const apps: AppPlan[] = await Promise.all(
      jobs.map(async (job) => ({
        app: job.app.name,
        identifier: job.bundleId,
        actions: [
          ...dimensionAdvisories(job),
          ...(await reconcileAssetActions(api, job, true, false)),
        ],
      })),
    );
    return {
      surface: SURFACE,
      store: 'appstore',
      state: 'planned',
      scope: 'app',
      direction: 'additive',
      apps,
    };
  },
};
