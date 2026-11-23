import { resolveSidecarConfig } from '@/config/config.js';
import { loadGameCenterConfig, reconcileGameCenter } from '@/store/apple/game-center.js';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { SurfacePlanner } from '@/types/plan.js';
import type { GameCenterConfig } from '@/types/store-surface.js';
/** Surface id - also the value users pass as `launch-store plan game-center`. */
const SURFACE = 'game-center';
export const gameCenterPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor(bundleId) {
        return resolveSidecarConfig<GameCenterConfig>({
          typed: planContext.config.gameCenter?.[bundleId],
          configPath: 'gamecenter.config.json',
          explicitPath: false,
          load: loadGameCenterConfig,
        });
      },
      reconcile(api, bundleId, config) {
        return reconcileGameCenter(api, { bundleId, config, dryRun: true });
      },
    });
  },
};
