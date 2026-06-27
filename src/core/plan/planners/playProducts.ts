/**
 * The Google Play in-app-products plan surface: the one-off (non-subscription) managed products a user
 * declares under `products[bundleId].inAppPurchases` that carry a `play` override. Runs the same
 * reconciler as `launch play-products` ({@link reconcilePlayProducts}) in dry-run, so the diff it reports
 * is exactly what that command would apply — minus any writes. Apple-only purchases (no `play` override)
 * are filtered out, mirroring the command's own gating.
 *
 * The catalog is keyed by iOS bundle id, so an app needs both a `packageName` (to reach Play) and a
 * `bundleId` (to locate its products); apps missing either, or with no Play-overridden product, contribute
 * nothing to this surface.
 */

import { reconcilePlayProducts, type PlayProductsApi } from '../../playProducts.js';
import type { AppDescriptor, InAppPurchaseConfig, LaunchConfig } from '../../types.js';
import type { AppPlan, PlanContext, SurfacePlan, SurfacePlanner } from '../types.js';

/** Surface id — also the value users pass as `launch plan play-products`. */
const SURFACE = 'play-products';

/** One app's Play-products plan target: its package name paired with the declared Play-overridden products. */
interface PlayProductsTarget {
  app: string;
  packageName: string;
  products: InAppPurchaseConfig[];
}

/** Resolve the apps that declare at least one Play-overridden in-app product, with their package + products. */
function targetsFor(apps: AppDescriptor[], config: LaunchConfig): PlayProductsTarget[] {
  const targets: PlayProductsTarget[] = [];
  for (const app of apps) {
    if (!app.packageName || !app.bundleId) continue;
    const products = (config.products?.[app.bundleId]?.inAppPurchases ?? []).filter(
      (product) => product.play,
    );
    if (products.length === 0) continue;
    targets.push({ app: app.name, packageName: app.packageName, products });
  }
  return targets;
}

/** Plan one app's Play products in dry-run, capturing a precondition failure (e.g. unreachable app) as `error`. */
async function planTarget(api: PlayProductsApi, target: PlayProductsTarget): Promise<AppPlan> {
  try {
    const report = await reconcilePlayProducts(api, {
      packageName: target.packageName,
      products: target.products,
      dryRun: true,
    });
    return { app: target.app, identifier: target.packageName, actions: report.actions };
  } catch (error) {
    return {
      app: target.app,
      identifier: target.packageName,
      actions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The Play-products planner. Omits itself when no app declares a Play-overridden product; reports a skip
 * with an actionable hint when no Play service account is configured (the `--check` gate turns that into
 * an error); otherwise returns the per-app diff. Apps are planned concurrently and isolated — one app's
 * precondition failure is recorded on its {@link AppPlan} and never aborts the rest.
 */
export const playProductsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'play',
  async plan(ctx: PlanContext): Promise<SurfacePlan> {
    const targets = targetsFor(ctx.apps, ctx.config);
    if (targets.length === 0) return { surface: SURFACE, store: 'play', state: 'omitted' };

    const api = await ctx.resolvePlayApi();
    if (!api) {
      return {
        surface: SURFACE,
        store: 'play',
        state: 'skipped',
        reason: 'no Play service account',
        hint: 'run `launch creds set-key --platform android`',
      };
    }

    const apps = await Promise.all(targets.map((target) => planTarget(api, target)));
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
