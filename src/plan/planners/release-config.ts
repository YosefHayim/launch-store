// Compares App Store Connect release settings with the local release config.

import { launchConfigForApp } from '@/config/config.js';
import { reconcileReleasePlan } from '@/release/release-attributes.js';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { AppDescriptor } from '@/types/app.js';
import type { AscSurfacesApi, SurfacePlanner } from '@/types/plan.js';
import type { ReleaseAttributesConfig } from '@/types/store-surface.js';

/** Surface id - also the value users pass as `launch-store plan release-config`. */
const SURFACE = 'release-config';

export const releaseConfigPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    async function readReleaseAttributesSection(
      bundleId: string,
    ): Promise<ReleaseAttributesConfig | undefined> {
      function hasThisBundle(discoveredApp: AppDescriptor): boolean {
        return discoveredApp.bundleId == bundleId;
      }

      const discoveredApp = planContext.apps.find(hasThisBundle);
      const isAppMissing = discoveredApp == null;

      if (isAppMissing) {
        return planContext.config.releaseAttributes?.[bundleId];
      }

      const launchFile = await launchConfigForApp(planContext.config, discoveredApp.dir);

      return launchFile.releaseAttributes?.[bundleId];
    }

    function reconcileReleaseAttributesSection(
      api: AscSurfacesApi,
      bundleId: string,
      releaseAttributesSection: ReleaseAttributesConfig,
    ) {
      return reconcileReleasePlan(api, {
        bundleId,
        config: releaseAttributesSection,
        dryRun: true,
      });
    }

    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'two-way',
      configFor: readReleaseAttributesSection,
      reconcile: reconcileReleaseAttributesSection,
    });
  },
};
