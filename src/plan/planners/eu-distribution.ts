// Compares App Store Connect European Union distribution domains with local config.

import { resolveSidecarConfig } from '@/config/config.js';
import {
  loadEuDistributionConfig,
  reconcileEuDistributionDomains,
} from '@/store/apple/eu-distribution.js';
import { planTeamSurface } from './app-store-surface.ts';
import type { SurfacePlanner } from '@/types/plan.js';
import type { EuDistributionConfig } from '@/types/store-surface.js';
/** Surface id - also the value users pass as `launch-store plan eu-distribution`. */
const SURFACE = 'eu-distribution';
export const euDistributionPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    return planTeamSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      config() {
        return resolveSidecarConfig<EuDistributionConfig>({
          typed: planContext.config.euDistribution,
          configPath: 'eu-distribution.config.json',
          explicitPath: false,
          load: loadEuDistributionConfig,
        });
      },
      reconcile(api, config) {
        return reconcileEuDistributionDomains(api, config, true);
      },
    });
  },
};
