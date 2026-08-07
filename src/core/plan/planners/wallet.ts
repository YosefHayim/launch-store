import { resolveSidecarConfig } from '@core/config/config.js';
import { loadWalletConfig, reconcileWalletIds } from '@core/store/walletIds.js';
import { planTeamSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@core/types/plan.js';
import type { WalletConfig } from '@core/types/storeSurface.js';
/** Surface id - also the value users pass as `launch plan wallet`. */
const SURFACE = 'wallet';
export const walletPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (planContext) =>
    planTeamSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      config: () =>
        resolveSidecarConfig<WalletConfig>({
          typed: planContext.config.wallet,
          configPath: 'wallet.config.json',
          explicitPath: false,
          load: loadWalletConfig,
        }),
      reconcile: (api, config) => reconcileWalletIds(api, config, true),
    }),
};
