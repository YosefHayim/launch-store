// Compares App Store Connect territory availability with the local config.

import { launchConfigForApp } from '@/config/config.js';
import { reconcileAvailability, type AvailabilityConfig } from '@/apple/store/availability.js';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { AppDescriptor } from '@/types/app.js';
import type { AscSurfacesApi, SurfacePlanner } from '@/types/plan.js';

const SURFACE = 'availability';

export const availabilityPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    async function readAvailabilitySection(
      bundleId: string,
    ): Promise<AvailabilityConfig | undefined> {
      function hasThisBundle(discoveredApp: AppDescriptor): boolean {
        return discoveredApp.bundleId == bundleId;
      }

      const discoveredApp = planContext.apps.find(hasThisBundle);
      const isAppMissing = discoveredApp == null;

      if (isAppMissing) {
        return planContext.config.availability?.[bundleId];
      }

      const launchFile = await launchConfigForApp(planContext.config, discoveredApp.dir);

      return launchFile.availability?.[bundleId];
    }

    function reconcileAvailabilitySection(
      api: AscSurfacesApi,
      bundleId: string,
      availabilitySection: AvailabilityConfig,
    ) {
      return reconcileAvailability(api, {
        bundleId,
        config: availabilitySection,
        dryRun: true,
      });
    }

    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'two-way',
      configFor: readAvailabilitySection,
      reconcile: reconcileAvailabilitySection,
    });
  },
};
