// Compares App Store Connect Wallet merchant identifiers with the local config.

import { reconcileWalletIds } from '@/apple/store/wallet-ids.js';
import { planTeamSurface } from './app-store-surface.ts';
import type { AscSurfacesApi, SurfacePlanner } from '@/types/plan.js';
import type { WalletConfig } from '@/types/store-surface.js';

/** Surface id - also the value users pass as `launch-store plan wallet`. */
const SURFACE = 'wallet';

export const walletPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    function readWalletSection(): WalletConfig | undefined {
      return planContext.config.wallet;
    }

    function reconcileWalletSection(api: AscSurfacesApi, walletSection: WalletConfig) {
      return reconcileWalletIds(api, walletSection, true);
    }

    return planTeamSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      config: readWalletSection,
      reconcile: reconcileWalletSection,
    });
  },
};
