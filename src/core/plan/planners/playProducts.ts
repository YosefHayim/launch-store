import { Effect } from 'effect';
import { errorMessage } from '@core/services/errorMessage.js';
import { reconcilePlayProducts, type PlayProductsApi } from '@core/store/playProducts.js';
import type { AppDescriptor } from '@core/types/app.js';
import type { InAppPurchaseConfig } from '@core/types/catalog.js';
import type { LaunchConfig } from '@core/types/config.js';
import type { AppPlan, PlanContext, SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan play-products`. */
const SURFACE = 'play-products';
/** One app's Play-products plan target: its package name paired with the declared Play-overridden products. */
type PlayProductsTarget = {
  app: string;
  packageName: string;
  products: InAppPurchaseConfig[];
};
/** Resolve the apps that declare at least one Play-overridden in-app product, with their package + products. */
const targetsFor = (apps: readonly AppDescriptor[], config: LaunchConfig): PlayProductsTarget[] => {
  const targets: PlayProductsTarget[] = [];
  for (const app of apps) {
    if (!app.packageName) continue;
    if (!app.bundleId) continue;
    let configuredProducts = config.products?.[app.bundleId]?.inAppPurchases;
    if (configuredProducts === undefined) configuredProducts = [];
    const products = configuredProducts.filter((product) => product.play);
    if (products.length === 0) continue;
    targets.push({ app: app.name, packageName: app.packageName, products });
  }
  return targets;
};
/** Plan one app's Play products in dry-run, capturing a precondition failure (e.g. unreachable app) as `error`. */
const planTarget = (api: PlayProductsApi, target: PlayProductsTarget): Effect.Effect<AppPlan> =>
  reconcilePlayProducts(api, {
    packageName: target.packageName,
    products: target.products,
    dryRun: true,
  }).pipe(
    Effect.match({
      onSuccess: (report): AppPlan => ({
        app: target.app,
        identifier: target.packageName,
        actions: report.actions,
      }),
      onFailure: (reconciliationFailure): AppPlan => ({
        app: target.app,
        identifier: target.packageName,
        actions: [],
        error: errorMessage(reconciliationFailure),
      }),
    }),
  );
/**
 * The Play-products planner. Omits itself when no app declares a Play-overridden product; reports a skip
 * with an actionable hint when no Play service account is configured (the `--check` gate turns that into
 * an error); otherwise returns the per-app diff. Apps are planned concurrently and isolated - one app's
 * precondition failure is recorded on its {@link AppPlan} and never aborts the rest.
 */
export const playProductsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'play',
  plan(planContext: PlanContext) {
    return Effect.gen(function* () {
      const targets = targetsFor(planContext.apps, planContext.config);
      if (targets.length === 0) return { surface: SURFACE, store: 'play', state: 'omitted' };
      const api = yield* planContext.resolvePlayApi();
      if (!api) {
        return {
          surface: SURFACE,
          store: 'play',
          state: 'skipped',
          reason: 'no Play service account',
          hint: 'run `launch creds set-key --platform android`',
        };
      }
      const apps = yield* Effect.forEach(targets, (target) => planTarget(api, target), {
        concurrency: 'unbounded',
      });
      return {
        surface: SURFACE,
        store: 'play',
        state: 'planned',
        scope: 'app',
        direction: 'two-way',
        apps,
      };
    });
  },
};
