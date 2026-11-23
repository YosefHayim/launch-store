import { reconcileApp, type AscCatalogApi } from '@/store/apple/asc-sync.js';
import { buildJobs, type SyncJob } from '@/store/shared/sync-jobs.js';
import { errorMessage } from '@/services/platform/error-message.js';
import type { AppPlan, PlanContext, SurfacePlanner } from '@/types/plan.js';

const SURFACE = 'catalog';

function isAppleAccountMissing(api: AscCatalogApi | null): api is null {
  return api == null;
}

async function planJob(api: AscCatalogApi, job: SyncJob): Promise<AppPlan> {
  try {
    const report = await reconcileApp(api, {
      bundleId: job.bundleId,
      capabilities: job.capabilities,
      products: job.products,
      dryRun: true,
      allowDestructive: false,
    });

    return {
      app: job.app.name,
      identifier: job.bundleId,
      actions: report.actions,
    };
  } catch (reconciliationFailure) {
    return {
      app: job.app.name,
      identifier: job.bundleId,
      actions: [],
      error: errorMessage(reconciliationFailure),
    };
  }
}

export const catalogPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  async plan(planContext: PlanContext) {
    const jobs = await buildJobs(planContext.apps, planContext.config);

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

    function planCatalogJob(job: SyncJob): Promise<AppPlan> {
      return planJob(appleApi, job);
    }

    const apps = await Promise.all(jobs.map(planCatalogJob));

    return {
      surface: SURFACE,
      store: 'appstore',
      state: 'planned',
      scope: 'app',
      direction: 'two-way',
      apps,
    };
  },
};
