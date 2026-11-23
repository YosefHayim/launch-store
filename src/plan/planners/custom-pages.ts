// Compares App Store Connect custom product pages with the local config.

import { launchConfigForApp } from '@/config/config.js';
import {
  reconcileCustomProductPages,
  type CustomProductPagesConfig,
} from '@/store/apple/custom-product-pages.js';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { AppDescriptor } from '@/types/app.js';
import type { AscSurfacesApi, SurfacePlanner } from '@/types/plan.js';

/** Surface id - also the value users pass as `launch-store plan custom-pages`. */
const SURFACE = 'custom-pages';

export const customPagesPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    async function readCustomPagesSection(
      bundleId: string,
    ): Promise<CustomProductPagesConfig | undefined> {
      function hasThisBundle(discoveredApp: AppDescriptor): boolean {
        return discoveredApp.bundleId == bundleId;
      }

      const discoveredApp = planContext.apps.find(hasThisBundle);
      const isAppMissing = discoveredApp == null;

      if (isAppMissing) {
        return planContext.config.customPages?.[bundleId];
      }

      const launchFile = await launchConfigForApp(planContext.config, discoveredApp.dir);

      return launchFile.customPages?.[bundleId];
    }

    function reconcileCustomPagesSection(
      api: AscSurfacesApi,
      bundleId: string,
      customPagesSection: CustomProductPagesConfig,
    ) {
      return reconcileCustomProductPages(api, {
        bundleId,
        config: customPagesSection,
        dryRun: true,
      });
    }

    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'two-way',
      configFor: readCustomPagesSection,
      reconcile: reconcileCustomPagesSection,
    });
  },
};
