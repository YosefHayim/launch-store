import { appDeclaresOffers, reconcileOffers } from '../../store/apple/offers.ts';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { SurfacePlanner } from '../../types/plan.ts';
/** Surface id - also the value users pass as `launch-store plan offers`. */
const SURFACE = 'offers';
export const offersPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor(bundleId) {
        const products = planContext.config.products?.[bundleId];

        if (products && appDeclaresOffers(products)) return products;

        return undefined;
      },
      reconcile(api, bundleId, products) {
        return reconcileOffers(api, { bundleId, products, dryRun: true });
      },
    });
  },
};
