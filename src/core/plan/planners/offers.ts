import { appDeclaresOffers, reconcileOffers } from '@core/store/offers.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan offers`. */
const SURFACE = 'offers';
export const offersPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (planContext) =>
    planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor: (bundleId) => {
        const products = planContext.config.products?.[bundleId];
        if (products && appDeclaresOffers(products)) return products;
        return undefined;
      },
      reconcile: (api, bundleId, products) =>
        reconcileOffers(api, { bundleId, products, dryRun: true }),
    }),
};
