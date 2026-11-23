// Compares App Store Connect App Clip cards with the local config.

import { launchConfigForApp } from '@/config/config.js';
import { reconcileAppClips } from '@/apple/store/app-clips.js';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { AppClipsConfig } from '@/types/store-surface.js';
import type { AppDescriptor } from '@/types/app.js';
import type { AscSurfacesApi, SurfacePlanner } from '@/types/plan.js';

/** Surface id - also the value users pass as `launch-store plan app-clips`. */
const SURFACE = 'app-clips';

export const appClipsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    async function readAppClipsSection(bundleId: string): Promise<AppClipsConfig | undefined> {
      function hasThisBundle(discoveredApp: AppDescriptor): boolean {
        return discoveredApp.bundleId == bundleId;
      }

      const discoveredApp = planContext.apps.find(hasThisBundle);
      const isAppMissing = discoveredApp == null;

      if (isAppMissing) {
        return planContext.config.appClips?.[bundleId];
      }

      const launchFile = await launchConfigForApp(planContext.config, discoveredApp.dir);

      return launchFile.appClips?.[bundleId];
    }

    function reconcileAppClipsSection(
      api: AscSurfacesApi,
      bundleId: string,
      appClipsSection: AppClipsConfig,
    ) {
      return reconcileAppClips(api, {
        bundleId,
        config: appClipsSection,
        dryRun: true,
      });
    }

    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor: readAppClipsSection,
      reconcile: reconcileAppClipsSection,
    });
  },
};
