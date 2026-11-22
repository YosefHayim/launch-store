import { errorMessage } from '../../services/platform/error-message.ts';
import { reconcilePlayProducts, type PlayProductsApi } from '../../store/google/play-products.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { InAppPurchaseConfig } from '../../types/catalog.ts';
import type { LaunchConfig } from '../../types/config.ts';
import type { AppPlan, PlanContext, PlayCatalogApi, SurfacePlanner } from '../../types/plan.ts';

const SURFACE = 'play-products';

type PlayProductsTarget = {
  app: string;
  packageName: string;
  products: InAppPurchaseConfig[];
};

function hasPlayOverride(product: InAppPurchaseConfig): boolean {
  return product.play != null;
}

function isStoreIdMissing(storeId: string | undefined): storeId is undefined {
  return storeId == null;
}

function isProductListMissing(
  products: readonly InAppPurchaseConfig[] | undefined,
): products is undefined {
  return products == null;
}

function targetsFor(apps: readonly AppDescriptor[], config: LaunchConfig): PlayProductsTarget[] {
  const targets: PlayProductsTarget[] = [];

  for (const app of apps) {
    const packageName = app.packageName;

    if (isStoreIdMissing(packageName)) {
      continue;
    }

    const bundleId = app.bundleId;

    if (isStoreIdMissing(bundleId)) {
      continue;
    }

    const configuredProducts = config.products?.[bundleId]?.inAppPurchases;

    if (isProductListMissing(configuredProducts)) {
      continue;
    }

    const products = configuredProducts.filter(hasPlayOverride);
    const hasPlayProducts = products.length > 0;

    if (hasPlayProducts == false) {
      continue;
    }

    targets.push({ app: app.name, packageName, products });
  }

  return targets;
}

async function planTarget(api: PlayProductsApi, target: PlayProductsTarget): Promise<AppPlan> {
  try {
    const report = await reconcilePlayProducts(api, {
      packageName: target.packageName,
      products: target.products,
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

export const playProductsPlanner: SurfacePlanner = {
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
        hint: 'run `launch creds set-key --platform android --app <name>`',
      };
    }

    async function planPlayProducts(target: PlayProductsTarget, index: number): Promise<AppPlan> {
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

    const apps = await Promise.all(targets.map(planPlayProducts));

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
