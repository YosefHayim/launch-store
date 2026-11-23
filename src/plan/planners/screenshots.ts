import { reconcileAssetActions } from '../../store/shared/sync-run.ts';
import { buildJobs, type SyncJob } from '../../store/shared/sync-jobs.ts';
import { checkScreenshotFile } from '../../listing/screenshots/specs.ts';
import type { PlannedAction } from '../../types/reconcile.ts';
import type { AppPlan, AscSurfacesApi, PlanContext, SurfacePlanner } from '../../types/plan.ts';

const SURFACE = 'screenshots';

type DimensionCheck =
  | { measured: false }
  | { measured: true; verdict: { ok: true } | { ok: false; reason: string } };

function isAppleAccountMissing(api: AscSurfacesApi | null): api is null {
  return api == null;
}

function isUnmeasured(dimensionCheck: DimensionCheck): dimensionCheck is { measured: false } {
  return dimensionCheck.measured == false;
}

function isOnSpec(verdict: { ok: boolean }): verdict is { ok: true } {
  return verdict.ok == true;
}

function hasAssets(job: SyncJob): boolean {
  const hasScreenshots = job.screenshots.length > 0;

  if (hasScreenshots) {
    return true;
  }

  const hasPreviews = job.previews.length > 0;

  if (hasPreviews) {
    return true;
  }

  return job.subscriptionReviewScreenshots.length > 0;
}

async function dimensionAdvisories(job: SyncJob): Promise<PlannedAction[]> {
  const advisoryActions: PlannedAction[] = [];

  for (const screenshot of job.screenshots) {
    const dimensionCheck: DimensionCheck = await checkScreenshotFile(
      'ios',
      screenshot.displayType,
      screenshot.path,
    );

    if (isUnmeasured(dimensionCheck)) {
      continue;
    }

    if (isOnSpec(dimensionCheck.verdict)) {
      continue;
    }

    advisoryActions.push({
      description: `off-spec screenshot ${screenshot.fileName} [${screenshot.locale}/${screenshot.displayType}]: ${dimensionCheck.verdict.reason}`,
      destructive: false,
      status: 'skipped',
    });
  }

  return advisoryActions;
}

async function planScreenshotJob(api: AscSurfacesApi, job: SyncJob): Promise<AppPlan> {
  const advisoryActions = await dimensionAdvisories(job);
  const reconcileActions = await reconcileAssetActions(api, job, true, false);

  return {
    app: job.app.name,
    identifier: job.bundleId,
    actions: [...advisoryActions, ...reconcileActions],
  };
}

export const screenshotsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  async plan(planContext: PlanContext) {
    const allJobs = await buildJobs(planContext.apps, planContext.config);
    const jobs = allJobs.filter(hasAssets);

    const isNothingDeclared = jobs.length == 0;

    if (isNothingDeclared) {
      return { surface: SURFACE, store: 'appstore', state: 'omitted' };
    }

    const api = await planContext.resolveAscApi();

    if (isAppleAccountMissing(api)) {
      return {
        surface: SURFACE,
        store: 'appstore',
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch-store creds set-key`',
      };
    }

    const appleApi = api;

    function planJob(job: SyncJob): Promise<AppPlan> {
      return planScreenshotJob(appleApi, job);
    }

    const apps = await Promise.all(jobs.map(planJob));

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
