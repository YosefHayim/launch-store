import { reconcileAppListing, type AscCatalogApi } from '../../store/apple/ascSync.ts';
import { buildJobs, hasListing, type SyncJob } from '../../store/shared/syncJobs.ts';
import type { AppleStoreConfig } from '../../store/shared/storeConfig.ts';
import { errorMessage } from '../../services/platform/errorMessage.ts';
import type { AppPlan, PlanContext, SurfacePlanner } from '../../types/plan.ts';

const SURFACE = 'listing';

function isAppleAccountMissing(api: AscCatalogApi | null): api is null {
  return api == null;
}

type ListingTarget = {
  app: string;
  bundleId: string;
  listing: AppleStoreConfig;
};

async function planTarget(api: AscCatalogApi, target: ListingTarget): Promise<AppPlan> {
  try {
    const report = await reconcileAppListing(api, {
      bundleId: target.bundleId,
      listing: target.listing,
      dryRun: true,
    });

    return {
      app: target.app,
      identifier: target.bundleId,
      actions: report.actions,
    };
  } catch (reconciliationFailure) {
    return {
      app: target.app,
      identifier: target.bundleId,
      actions: [],
      error: errorMessage(reconciliationFailure),
    };
  }
}

function listingTarget(job: SyncJob): ListingTarget | null {
  const listing = job.listing;

  if (hasListing(listing)) {
    return { app: job.app.name, bundleId: job.bundleId, listing };
  }

  return null;
}

export const listingPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  async plan(planContext: PlanContext) {
    const jobs = await buildJobs(planContext.apps, planContext.config);
    const targets: ListingTarget[] = [];

    for (const job of jobs) {
      const target = listingTarget(job);
      const isMissing = target == null;

      if (isMissing) {
        continue;
      }

      targets.push(target);
    }

    const isNothingDeclared = targets.length == 0;

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
        hint: 'run `launch creds set-key`',
      };
    }

    const appleApi = api;

    function planListing(target: ListingTarget): Promise<AppPlan> {
      return planTarget(appleApi, target);
    }

    const apps = await Promise.all(targets.map(planListing));

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
