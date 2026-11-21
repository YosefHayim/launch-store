import { resolveSidecarConfig } from '@/config/config.js';
import { loadGameCenterConfig, reconcileGameCenter } from '@/store/apple/gameCenter.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@/types/plan.js';
import type { GameCenterConfig } from '@/types/storeSurface.js';
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
