/**
 * The App Store **offers** plan surface: a subscription's offer codes, promotional / introductory / win-back
 * offers, plus an app's promoted-purchase ordering. Wraps `launch offers`'s reconciler ({@link reconcileOffers})
 * in dry-run, reading desired state from the typed `products[bundleId]` catalog. Additive: Apple makes offer
 * terms immutable once created, so the reconciler only creates the offers it can't find and never deletes one —
 * a `= in sync` result means "every declared offer exists," not that no extra offers live in the portal.
 *
 * The surface omits any app that declares only plain products (no offers, no promoted purchases) via
 * {@link appDeclaresOffers}, so a catalog-only project never sees an empty offers diff.
 */

import { appDeclaresOffers, reconcileOffers } from '../../offers.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '../types.js';

/** Surface id — also the value users pass as `launch plan offers`. */
const SURFACE = 'offers';

export const offersPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (ctx) =>
    planAppStoreSurface(ctx, {
      surface: SURFACE,
      direction: 'additive',
      configFor: (bundleId) => {
        const products = ctx.config.products?.[bundleId];
        return products && appDeclaresOffers(products) ? products : undefined;
      },
      reconcile: (api, bundleId, products) =>
        reconcileOffers(api, { bundleId, products, dryRun: true }),
    }),
};
