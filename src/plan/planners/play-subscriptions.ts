import { errorMessage } from '@/services/platform/error-message.js';
import {
  reconcilePlaySubscriptions,
  type PlaySubscriptionsApi,
} from '@/store/google/play-subscriptions.js';
import type { AppDescriptor } from '@/types/app.js';
import type { SubscriptionConfig, SubscriptionGroupConfig } from '@/types/catalog.js';
import type { LaunchConfig } from '@/types/config.js';
import type { AppPlan, PlanContext, PlayCatalogApi, SurfacePlanner } from '@/types/plan.js';

const SURFACE = 'play-subscriptions';

type PlaySubscriptionsTarget = {
  app: string;
  packageName: string;
  subscriptions: SubscriptionConfig[];
};

function hasPlayOverride(subscription: SubscriptionConfig): boolean {
  return subscription.play != null;
}

function isStoreIdMissing(storeId: string | undefined): storeId is undefined {
  return storeId == null;
}

function isGroupListMissing(
  groups: readonly SubscriptionGroupConfig[] | undefined,
): groups is undefined {
  return groups == null;
}

function groupSubscriptions(group: SubscriptionGroupConfig): readonly SubscriptionConfig[] {
  return group.subscriptions;
}

function targetsFor(
  apps: readonly AppDescriptor[],
  config: LaunchConfig,
): PlaySubscriptionsTarget[] {
  const targets: PlaySubscriptionsTarget[] = [];

  for (const app of apps) {
    const packageName = app.packageName;

    if (isStoreIdMissing(packageName)) {
      continue;
    }

    const bundleId = app.bundleId;

    if (isStoreIdMissing(bundleId)) {
      continue;
    }

    const configuredGroups = config.products?.[bundleId]?.subscriptionGroups;

    if (isGroupListMissing(configuredGroups)) {
      continue;
    }

    const subscriptions = configuredGroups.flatMap(groupSubscriptions).filter(hasPlayOverride);
    const hasPlaySubscriptions = subscriptions.length > 0;

    if (hasPlaySubscriptions == false) {
      continue;
    }

    targets.push({ app: app.name, packageName, subscriptions });
  }

  return targets;
}

async function planTarget(
  api: PlaySubscriptionsApi,
  target: PlaySubscriptionsTarget,
): Promise<AppPlan> {
  try {
    const report = await reconcilePlaySubscriptions(api, {
      packageName: target.packageName,
      subscriptions: target.subscriptions,
      dryRun: true,
    });

    return {
      app: target.app,
      identifier: target.packageName,
      actions: report.actions,
    };
  } catch (reconciliationFailure) {
    return {
      app: target.app,
      identifier: target.packageName,
      actions: [],
      error: errorMessage(reconciliationFailure),
    };
  }
}

function isMissingClient(api: PlayCatalogApi | null | undefined): api is null | undefined {
  return api == null;
}

export const playSubscriptionsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'play',
  async plan(planContext: PlanContext) {
    const targets = targetsFor(planContext.apps, planContext.config);

    const isNothingDeclared = targets.length == 0;

    if (isNothingDeclared) {
      return { surface: SURFACE, store: 'play', state: 'omitted' };
    }

    const targetClients: Array<PlayCatalogApi | null> = [];

    for (const target of targets) {
      const playClient = await planContext.resolvePlayApi(target.packageName);
      targetClients.push(playClient);
    }

    const isEveryClientMissing = targetClients.every(isMissingClient);

    if (isEveryClientMissing) {
      return {
        surface: SURFACE,
        store: 'play',
        state: 'skipped',
        reason: 'no Play service account',
        hint: 'run `launch-store creds set-key --platform android --app <name>`',
      };
    }

    async function planPlaySubscriptions(
      target: PlaySubscriptionsTarget,
      index: number,
    ): Promise<AppPlan> {
      const api = targetClients[index];

      if (isMissingClient(api)) {
        return {
          app: target.app,
          identifier: target.packageName,
          actions: [],
          error: 'No Play service account for this package.',
        };
      }

      return planTarget(api, target);
    }

    const apps = await Promise.all(targets.map(planPlaySubscriptions));

    return {
      surface: SURFACE,
      store: 'play',
      state: 'planned',
      scope: 'app',
      direction: 'two-way',
      apps,
    };
  },
};
