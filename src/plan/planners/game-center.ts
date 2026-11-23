// Compares App Store Connect Game Center achievements and leaderboards with local config.

import { launchConfigForApp } from '../../config/config.ts';
import { reconcileGameCenter } from '../../apple/game-center.ts';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { AppDescriptor } from '../../types/app.ts';
import type { AscSurfacesApi, SurfacePlanner } from '../../types/plan.ts';
import type { GameCenterConfig } from '../../types/store-surface.ts';

/** Surface id - also the value users pass as `launch-store plan game-center`. */
const SURFACE = 'game-center';

export const gameCenterPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    async function readGameCenterSection(bundleId: string): Promise<GameCenterConfig | undefined> {
      function hasThisBundle(discoveredApp: AppDescriptor): boolean {
        return discoveredApp.bundleId == bundleId;
      }

      const discoveredApp = planContext.apps.find(hasThisBundle);
      const isAppMissing = discoveredApp == null;

      if (isAppMissing) {
        return planContext.config.gameCenter?.[bundleId];
      }

      const launchFile = await launchConfigForApp(planContext.config, discoveredApp.dir);

      return launchFile.gameCenter?.[bundleId];
    }

    function reconcileGameCenterSection(
      api: AscSurfacesApi,
      bundleId: string,
      gameCenterSection: GameCenterConfig,
    ) {
      return reconcileGameCenter(api, {
        bundleId,
        config: gameCenterSection,
        dryRun: true,
      });
    }

    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor: readGameCenterSection,
      reconcile: reconcileGameCenterSection,
    });
  },
};
