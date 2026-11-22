import { resolveSidecarConfig } from '../../config/config.ts';
import { loadWalletConfig, reconcileWalletIds } from '../../store/apple/walletIds.ts';
import { planTeamSurface } from './appStoreSurface.ts';
import type { SurfacePlanner } from '../../types/plan.ts';
import type { WalletConfig } from '../../types/storeSurface.ts';
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
