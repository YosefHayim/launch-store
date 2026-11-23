import { resolveSidecarConfig } from '@/config/config.js';
import { loadWalletConfig, reconcileWalletIds } from '@/store/apple/wallet-ids.js';
import { planTeamSurface } from './app-store-surface.ts';
import type { SurfacePlanner } from '@/types/plan.js';
import type { WalletConfig } from '@/types/store-surface.js';
/** Surface id - also the value users pass as `launch-store plan wallet`. */
const SURFACE = 'wallet';
export const walletPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    return planTeamSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      config() {
        return resolveSidecarConfig<WalletConfig>({
          typed: planContext.config.wallet,
          configPath: 'wallet.config.json',
          explicitPath: false,
          load: loadWalletConfig,
        });
      },
      reconcile(api, config) {
        return reconcileWalletIds(api, config, true);
      },
    });
  },
};
