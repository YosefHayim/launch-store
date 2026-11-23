// Compares App Store Connect territory availability with the local config.

import { pathExists } from '@/path-exists.js';
import { readAvailabilityConfig, reconcileAvailability } from '@/store/apple/availability.js';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { SurfacePlanner } from '@/types/plan.js';

const SURFACE = 'availability';

export const availabilityPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  async plan(planContext) {
    async function readAvailabilityConfigForApp() {
      let configPath = planContext.config.configFiles?.availability;

      if (configPath == null) {
        configPath = 'availability.config.json';
      }

      const configExists = await pathExists(configPath);

      if (configExists == false) {
        return undefined;
      }

      return readAvailabilityConfig(configPath);
    }

    function reconcileAppAvailability(
      api: Parameters<typeof reconcileAvailability>[0],
      bundleId: string,
      config: Awaited<ReturnType<typeof readAvailabilityConfig>>,
    ) {
      return reconcileAvailability(api, { bundleId, config, dryRun: true });
    }

    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'two-way',
      configFor: readAvailabilityConfigForApp,
      reconcile: reconcileAppAvailability,
    });
  },
};
