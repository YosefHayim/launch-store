import { resolveSidecarConfig } from '../../config/config.ts';
import { loadGameCenterConfig, reconcileGameCenter } from '../../store/apple/game-center.ts';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { SurfacePlanner } from '../../types/plan.ts';
import type { GameCenterConfig } from '../../types/store-surface.ts';
/** Surface id - also the value users pass as `launch plan game-center`. */
const SURFACE = 'game-center';
export const gameCenterPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (planContext) =>
    planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor: (bundleId) =>
        resolveSidecarConfig<GameCenterConfig>({
          typed: planContext.config.gameCenter?.[bundleId],
          configPath: 'gamecenter.config.json',
          explicitPath: false,
          load: loadGameCenterConfig,
        }),
      reconcile: (api, bundleId, config) =>
        reconcileGameCenter(api, { bundleId, config, dryRun: true }),
    }),
};
